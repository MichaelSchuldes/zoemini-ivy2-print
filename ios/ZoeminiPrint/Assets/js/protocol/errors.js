/**
 * Custom Error Classes for Zoemini 2 / Ivy 2 Protocol
 * Mirrors dtgreene/ivy2 exceptions.py with descriptive user-facing messages.
 */

export class ZoeminiError extends Error {
  constructor(message, code = "ZOEMINI_ERROR") {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
  }
}

export class ClientUnavailableError extends ZoeminiError {
  constructor(message = "Printer connection is not active or has been closed.") {
    super(message, "CLIENT_UNAVAILABLE");
  }
}

export class ReceiveTimeoutError extends ZoeminiError {
  constructor(message = "Timed out waiting for a 34-byte response from the printer.") {
    super(message, "RECEIVE_TIMEOUT");
  }
}

export class AckError extends ZoeminiError {
  constructor(expectedAck, actualAck, headerError = 0) {
    super(
      `Printer returned unexpected ACK: expected 0x${expectedAck.toString(16).padStart(4, "0")}, got 0x${actualAck.toString(16).padStart(4, "0")} (error byte: ${headerError}).`,
      "INVALID_ACK"
    );
    this.expectedAck = expectedAck;
    this.actualAck = actualAck;
    this.headerError = headerError;
  }
}

export class LowBatteryError extends ZoeminiError {
  constructor(batteryLevel) {
    super(
      `Printer battery is too low to print (${batteryLevel}%). Please charge to at least 30%.`,
      "LOW_BATTERY"
    );
    this.batteryLevel = batteryLevel;
  }
}

export class CoverOpenError extends ZoeminiError {
  constructor() {
    super("Printer top cover is open. Please close the cover and try again.", "COVER_OPEN");
  }
}

export class NoPaperError extends ZoeminiError {
  constructor() {
    super("Printer is out of ZINK paper. Please load a paper pack and blue Smart Sheet.", "NO_PAPER");
  }
}

export class WrongSmartSheetError extends ZoeminiError {
  constructor() {
    super("Invalid or wrong calibration Smart Sheet detected in the printer.", "WRONG_SMART_SHEET");
  }
}

export class PrinterHardwareError extends ZoeminiError {
  constructor(errorCode) {
    super(`Printer reported non-zero hardware error code: ${errorCode}.`, "HARDWARE_ERROR");
    this.errorCode = errorCode;
  }
}
