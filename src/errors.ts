class FugueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class InvalidBase62Error extends FugueError {}

export class InvalidPositionError extends FugueError {}

export class InvalidBoundsError extends FugueError {}

export class InvalidRandomSourceError extends FugueError {}

export class CoordSpaceExhaustedError extends FugueError {}

export class BurstSpaceExhaustedError extends FugueError {}

export class SecureRandomUnavailableError extends FugueError {}
