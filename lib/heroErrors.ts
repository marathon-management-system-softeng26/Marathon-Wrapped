export class HeroValidationError extends Error {
  constructor(
    message = "Check the runner fields, timing and kilometer splits.",
  ) {
    super(message);
    this.name = "HeroValidationError";
  }
}
