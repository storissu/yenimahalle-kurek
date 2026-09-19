import { Smartphone } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { isStandalone } from '@/lib/platform';
import { safeGetItem, safeSetItem } from '@/lib/storage';
import { tr } from '@/strings/tr';

const DISMISSED_KEY = 'install-banner-dismissed';

/** Home-screen nudge for people using the site in a browser tab. `to` = the page that shows the full guide. */
export function InstallBanner({ to }: { to: string }) {
  const [dismissed, setDismissed] = useState(() => safeGetItem(DISMISSED_KEY) === '1');
  if (dismissed || isStandalone()) return null;

  return (
    <Card className="mb-5 flex flex-col gap-3 bg-primary-soft">
      <div className="flex items-start gap-3">
        <Smartphone aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={22} />
        <div>
          <h2 className="font-semibold text-primary">{tr.install.title}</h2>
          <p className="text-sm text-fg">{tr.install.body}</p>
        </div>
      </div>
      <div className="flex gap-2">
        <Link
          to={to}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-primary px-4 text-[15px] font-semibold text-primary-fg"
        >
          {tr.install.seeSteps}
        </Link>
        <Button
          variant="ghost"
          onClick={() => {
            safeSetItem(DISMISSED_KEY, '1');
            setDismissed(true);
          }}
        >
          {tr.install.dismiss}
        </Button>
      </div>
    </Card>
  );
}
