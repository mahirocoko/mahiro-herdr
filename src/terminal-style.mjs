// ANSI palette slots follow the user's terminal theme. Background/body paint
// stays inherited; exact resolved contrast is not asserted from escape codes.
const ROLES = {
  heading: 1,
  accent: 33,
  muted: 90,
  success: 32,
  danger: 31
}

export const createTerminalStyle = (
  output = process.stdout,
  env = process.env
) => {
  const enabled =
    output.isTTY === true && env.NO_COLOR === undefined && env.TERM !== 'dumb'
  return Object.fromEntries(
    Object.entries(ROLES).map(([role, code]) => [
      role,
      (value) =>
        enabled ? `\x1b[${code}m${String(value)}\x1b[0m` : String(value)
    ])
  )
}
