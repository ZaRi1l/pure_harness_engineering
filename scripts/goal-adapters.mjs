export const UNSUPPORTED = Symbol('GOAL adapter unsupported');

export function getGoalAdapter(context, registered = {}) {
  const type = context?.adapters?.goal?.type;
  if (typeof type !== 'string' || !Object.hasOwn(registered, type)) return UNSUPPORTED;
  const factory = registered[type];
  if (typeof factory !== 'function') return UNSUPPORTED;
  return factory(context);
}
