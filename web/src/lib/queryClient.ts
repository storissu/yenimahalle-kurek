import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
    mutations: {
      retry: 0,
      // TanStack's default ("online") silently PAUSES a save while the phone is offline: the button spins forever and
      // the request fires by itself on reconnect — possibly minutes later, after a deadline or the coach's own edit.
      // "always" tries at once, so an offline save fails immediately with the Turkish connection message and the
      // form keeps what was typed. (Reads keep the default: offline they simply show what is already loaded.)
      networkMode: 'always',
    },
  },
});
