import { CircleCheck, Smartphone } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { promptInstall, useCanPromptInstall } from '@/lib/install';
import { detectPlatform, isStandalone } from '@/lib/platform';
import { tr } from '@/strings/tr';

function Steps({ title, steps }: { title: string; steps: readonly string[] }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold">{title}</h3>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted marker:font-semibold marker:text-fg">
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}

/** Explains how to add the app to the Home Screen (needed for notifications on iPhone). */
export function InstallGuide() {
  const canPrompt = useCanPromptInstall();
  const platform = detectPlatform();

  if (isStandalone()) {
    return (
      <Card className="flex items-start gap-3">
        <CircleCheck aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={22} />
        <div>
          <h2 className="font-semibold">{tr.install.installedTitle}</h2>
          <p className="text-sm text-muted">{tr.install.installedBody}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <Smartphone aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={22} />
        <div>
          <h2 className="font-semibold">{tr.install.title}</h2>
          <p className="text-sm text-muted">{tr.install.body}</p>
        </div>
      </div>

      {canPrompt && (
        <Button onClick={() => void promptInstall()} fullWidth>
          {tr.install.installButton}
        </Button>
      )}

      {platform === 'ios' && (
        <>
          <Steps title={tr.install.iosTitle} steps={tr.install.iosSteps} />
          <p className="text-sm text-muted">{tr.install.iosNote}</p>
        </>
      )}
      {platform === 'android' && <Steps title={tr.install.androidTitle} steps={tr.install.androidSteps} />}
      {platform === 'other' && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-bold">{tr.install.otherTitle}</h3>
          <p className="text-sm text-muted">{tr.install.otherBody}</p>
        </div>
      )}
    </Card>
  );
}
