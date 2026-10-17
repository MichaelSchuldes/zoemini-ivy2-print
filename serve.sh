#!/usr/bin/env perl
use strict;
use warnings;
use IO::Socket::INET;
use File::Spec;
use Cwd qw(abs_path getcwd);

my $port = $ARGV[0] || 8080;
my $root = abs_path(getcwd());

my %mime_types = (
    'html' => 'text/html; charset=utf-8',
    'htm'  => 'text/html; charset=utf-8',
    'js'   => 'text/javascript; charset=utf-8',
    'mjs'  => 'text/javascript; charset=utf-8',
    'css'  => 'text/css; charset=utf-8',
    'json' => 'application/json; charset=utf-8',
    'png'  => 'image/png',
    'jpg'  => 'image/jpeg',
    'jpeg' => 'image/jpeg',
    'gif'  => 'image/gif',
    'webp' => 'image/webp',
    'svg'  => 'image/svg+xml',
    'ico'  => 'image/x-icon',
    'pdf'  => 'application/pdf',
    'md'   => 'text/markdown; charset=utf-8',
);

my $server = IO::Socket::INET->new(
    LocalAddr => '127.0.0.1',
    LocalPort => $port,
    Proto     => 'tcp',
    Listen    => 128,
    ReuseAddr => 1,
) or die "Could not start local server on http://localhost:$port : $!\n";

print "==============================================================\n";
print " Zoemini 2 Web Print Studio — Local Development Server\n";
print " Open in Chromium / Chrome: http://localhost:$port\n";
print " Press Ctrl+C to stop.\n";
print "==============================================================\n";

while (my $client = $server->accept()) {
    $client->autoflush(1);
    my $request_line = <$client>;
    if (!$request_line) {
        close($client);
        next;
    }

    # Consume remaining HTTP headers
    while (my $header = <$client>) {
        last if $header =~ /^\r?\n$/;
    }

    if ($request_line =~ m{^(GET|HEAD)\s+([^\s\?]+)}) {
        my ($method, $url_path) = ($1, $2);
        $url_path =~ s/%([0-9A-Fa-f]{2})/chr(hex($1))/eg;
        $url_path = '/index.html' if $url_path eq '/';

        # Prevent directory traversal
        $url_path =~ s{\.\.}{}g;
        my $file_path = File::Spec->catfile($root, split('/', $url_path));

        if (-f $file_path && open(my $fh, '<:raw', $file_path)) {
            local $/;
            my $body = <$fh>;
            close($fh);

            my ($ext) = $file_path =~ /\.([^.]+)$/;
            $ext = lc($ext || '');
            my $content_type = $mime_types{$ext} || 'application/octet-stream';
            my $len = length($body);

            print $client "HTTP/1.1 200 OK\r\n";
            print $client "Content-Type: $content_type\r\n";
            print $client "Content-Length: $len\r\n";
            print $client "Cache-Control: no-store\r\n";
            print $client "Access-Control-Allow-Origin: *\r\n";
            print $client "Connection: close\r\n\r\n";
            print $client $body if $method eq 'GET';
            printf "[200] %s %s (%d bytes)\n", $method, $url_path, $len;
        } else {
            my $msg = "404 Not Found: $url_path\n";
            print $client "HTTP/1.1 404 Not Found\r\n";
            print $client "Content-Type: text/plain; charset=utf-8\r\n";
            print $client "Content-Length: " . length($msg) . "\r\n";
            print $client "Connection: close\r\n\r\n";
            print $client $msg if $method eq 'GET';
            printf "[404] %s %s\n", $method, $url_path;
        }
    } else {
        print $client "HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n";
    }
    close($client);
}
