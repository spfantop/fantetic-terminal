export type GatewayHealthState = {
  guacamoleReady: boolean;
};

export const createHealthSnapshot = ({ guacamoleReady }: GatewayHealthState) => ({
  status: guacamoleReady ? 'ready' : 'not_ready',
  checks: {
    guacamole: guacamoleReady ? 'ready' : 'not_ready',
  },
});
