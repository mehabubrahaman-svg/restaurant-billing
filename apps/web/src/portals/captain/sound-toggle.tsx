import { Button, cn, Volume2, VolumeX } from '@restroos/ui';
import { useTranslation } from 'react-i18next';
import { unlockAudio } from '../../lib/chime';
import { useSoundStore } from '../../stores/sound-store';

/** Mutes this device's chimes (ready alerts, new KOTs, tokens). Remembered per device. */
export function SoundToggle({ className, size }: { className?: string; size?: 'touch' | 'kds' }) {
  const { t } = useTranslation();
  const muted = useSoundStore((s) => s.muted);
  const setMuted = useSoundStore((s) => s.setMuted);
  return (
    <Button
      variant="outline"
      size={size ?? 'touch'}
      aria-pressed={!muted}
      className={cn(className)}
      onClick={() => {
        // The tap also unlocks browser audio, which stays silent until a first gesture.
        if (muted) void unlockAudio();
        setMuted(!muted);
      }}
    >
      {muted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
      <span>{muted ? t('sound.off') : t('sound.on')}</span>
    </Button>
  );
}
