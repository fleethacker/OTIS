/** Display supplied ship names; never derive a hull number or vessel class. */
export function ShipName({ name }: { name: string }) {
  return <span className="ship-name">{name}</span>;
}

/**
 * Only use with a supplied hull identifier. ITC Machine is a locally licensed
 * font and is not bundled with this repository; the brand stylesheet owns its
 * local-font stack, white fill, and crisp offset shadow.
 */
export function HullNumber({ value }: { value: string }) {
  return <span className="hull-number">{value}</span>;
}
