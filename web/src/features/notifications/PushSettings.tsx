import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useToast } from '@/components/ui/Toast';
import { disablePush, enablePush, getCurrentSubscription, getPushSupport } from '@/lib/push';
import { tr } from '@/strings/tr';

const subscriptionKey = ['push-subscribed'] as const;

export function PushSettings() {
  const support = getPushSupport();
  const toast = useToast();
  const queryClient = useQueryClient();

  const subscribed = useQuery({
    queryKey: subscriptionKey,
    queryFn: async () => Boolean(await getCurrentSubscription()),
    enabled: support.supported,
    staleTime: 0,
  });

  const enable = useMutation({
    mutationFn: enablePush,
    onSuccess: (result) => {
      if (result === 'denied') toast.show(tr.push.denied, 'error');
      void queryClient.invalidateQueries({ queryKey: subscriptionKey });
    },
    onError: (error) => {
      const message = error instanceof Error && error.message === 'missing-vapid-key' ? tr.push.missingKey : tr.push.error;
      toast.show(message, 'error');
    },
  });

  const disable = useMutation({
    mutationFn: disablePush,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: subscriptionKey }),
    onError: () => toast.show(tr.push.error, 'error'),
  });

  const permission = support.supported ? Notification.permission : 'default';
  const isOn = subscribed.data === true && permission === 'granted';

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-semibold">
          {isOn ? <Bell aria-hidden="true" size={20} className="text-success" /> : <BellOff aria-hidden="true" size={20} className="text-muted" />}
          {tr.push.title}
        </h2>
        {support.supported && <Badge tone={isOn ? 'success' : 'neutral'}>{isOn ? tr.push.on : tr.push.off}</Badge>}
      </div>

      {!support.supported && (
        <p className="text-sm text-muted">
          {support.reason === 'ios-needs-install' ? tr.push.iosNeedsInstall : tr.push.unsupportedBrowser}
        </p>
      )}

      {support.supported && permission === 'denied' && <p className="text-sm text-danger">{tr.push.denied}</p>}

      {support.supported && permission !== 'denied' && !isOn && (
        <Button onClick={() => enable.mutate()} loading={enable.isPending}>
          {enable.isPending ? tr.push.enabling : tr.push.enable}
        </Button>
      )}

      {support.supported && isOn && (
        <Button variant="secondary" onClick={() => disable.mutate()} loading={disable.isPending}>
          {tr.push.disable}
        </Button>
      )}
    </Card>
  );
}
