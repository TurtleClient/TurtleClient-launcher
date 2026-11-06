// Fork-owned identity. Service integrations stay off until TurtleClient provides them.
export const BRAND = {
  name: 'TurtleClient Launcher',
  repository: 'https://github.com/TurtleClient/turtleclient-launcher',
  upstream: 'https://github.com/millida/launcher',
  services: false,
  updates: true,
} as const
