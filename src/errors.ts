class FugueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidBase62Error extends FugueError {}

export class InvalidPositionError extends FugueError {}

export class InvalidRunPrefixError extends FugueError {}

export class InvalidBoundsError extends FugueError {}

export class InvalidRandomSourceError extends FugueError {}

export class SlotExhaustedError extends FugueError {}

export class RunPrefixExhaustedError extends FugueError {}

export class SecureRandomUnavailableError extends FugueError {}
