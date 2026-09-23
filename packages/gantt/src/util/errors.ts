/** Thrown for invalid input or operations, e.g. unknown ids or a task moved into its own subtree. */
export class QuartzioError extends Error {
  override name = 'QuartzioError';
}
