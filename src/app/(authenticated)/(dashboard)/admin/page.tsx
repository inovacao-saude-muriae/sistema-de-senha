'use client';

import type { User } from 'next-auth';
import type { ApiErrorBody, QueueSyncBody } from '@/shared/types/api';

import { AlertTriangle, Monitor, RotateCcw, Trash2Icon } from 'lucide-react';
import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';

import { AccessSection } from '@/app/(authenticated)/(dashboard)/admin/access-section';
import {
  sectionEyebrowStyle,
  sectionHeadingStyle,
  sectionStyle,
  sectionTitleStyle,
} from '@/app/(authenticated)/(dashboard)/admin/admin-styles';
import { NewsSection } from '@/app/(authenticated)/(dashboard)/admin/news-section';
import {
  getQueueSnapshot,
  getServerQueueSnapshot,
  MIN_QUEUE_NUMBER,
  normalizeQueue,
  saveQueueState,
  subscribeQueue,
} from '@/client/queue/queue';
import { cn } from '@/client/utils';
import { FilterGroup } from '@/components/filter-group';
import { PageHeader } from '@/components/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { useEffectiveSession } from '@/hooks/use-effective-session';
import {
  CALL_TYPES,
  DEFAULT_SECTOR,
  getSector,
  MAX_QUEUE_NUMBER,
  NO_PASSWORD,
  SECTORS,
} from '@/shared/constants';
import { errorMessage } from '@/shared/errors';
import { readJson } from '@/shared/json';
import {
  canAccessSector,
  hasPermission,
  NEWS_CREATE,
  NEWS_DELETE,
  QUEUE_RESET,
  QUEUE_SYNC,
  SCREEN_ADMIN_FILAS,
  SCREEN_ADMIN_NOTICIAS,
  SCREEN_ADMIN_USUARIOS,
  SECTORS_MANAGE_ALL,
} from '@/shared/permissions';
import { formatNumberString, normalizeCallType } from '@/shared/queue-format';

export default function AdminPage() {
  const session = useEffectiveSession();
  const state = useSyncExternalStore(
    subscribeQueue,
    getQueueSnapshot,
    getServerQueueSnapshot,
  );
  const [resettingSector, setResettingSector] = useState<
    Record<string, boolean>
  >({});
  // alvo do reset pendente de confirmação (`"all"` ou o id do setor);
  // null = diálogo fechado
  const [resetPending, setResetPending] = useState<null | string>(null);

  if (!session) return null;

  /* permissões desta sessão: cada bloco da tela se renderiza por conta própria */
  const canManageFilas = hasPermission(session, SCREEN_ADMIN_FILAS);
  const canReset = hasPermission(session, QUEUE_RESET);
  const canSync = hasPermission(session, QUEUE_SYNC);
  const canManageNews = hasPermission(session, SCREEN_ADMIN_NOTICIAS);
  const canCreateNews = hasPermission(session, NEWS_CREATE);
  const canDeleteNews = hasPermission(session, NEWS_DELETE);
  const canManageUsers = hasPermission(session, SCREEN_ADMIN_USUARIOS);
  const canManageAllSectors = hasPermission(session, SECTORS_MANAGE_ALL);

  /* ── reset de fila ──
     O `window.confirm` virou um AlertDialog: os botões só guardam o alvo em
     `resetPending` (abrindo o diálogo) e a ação roda em `confirmReset`,
     quando o usuário confirma. */
  const resetIsAll = resetPending === 'all';
  let resetLabel = '';
  if (resetPending) {
    resetLabel = resetIsAll
      ? 'TODOS os setores (Farmácia e Recepção)'
      : getSector(resetPending)?.name || resetPending;
  }

  async function confirmReset() {
    const sectorId = resetPending;
    if (!sectorId) return;
    setResetPending(null);

    const isAll = sectorId === 'all';
    const label = isAll
      ? 'TODOS os setores (Farmácia e Recepção)'
      : getSector(sectorId)?.name || sectorId;

    const sectorsToReset = isAll ? Object.keys(SECTORS) : [sectorId];
    setResettingSector((prev) => {
      const next = { ...prev };
      sectorsToReset.forEach((s) => (next[s] = true));
      return next;
    });

    try {
      // Server first: the local replica is only dropped once the server has
      // actually reset. Doing it the other way round left every client wiped
      // locally while the server still had the old queue, with no rollback.
      const res = await fetch('/api/queue/reset', {
        body: JSON.stringify({ sector: sectorId }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await readJson<ApiErrorBody>(res).catch<ApiErrorBody>(
        () => ({}),
      );

      if (!res.ok) {
        toast.add({
          title: data.error || 'Erro ao zerar o contador no banco.',
          type: 'error',
        });
        return;
      }

      const currentState = getQueueSnapshot();
      const next = { ...currentState };
      sectorsToReset.forEach((s) => {
        next[s] = {
          ...normalizeQueue(currentState[s]),
          history: [],
          normalCurrent: NO_PASSWORD,
          priorityCurrent: NO_PASSWORD,
        };
      });
      saveQueueState(next);

      toast.add({
        title: isAll
          ? `Todas as senhas foram resetadas. Numeração reinicia em ${MIN_QUEUE_NUMBER.toString().padStart(3, '0')}.`
          : `Senhas de "${label}" zeradas. Numeração reinicia em ${MIN_QUEUE_NUMBER.toString().padStart(3, '0')}.`,
        type: 'success',
      });
    } catch {
      toast.add({ title: 'Erro ao zerar os contadores.', type: 'error' });
    } finally {
      setResettingSector((prev) => {
        const next = { ...prev };
        sectorsToReset.forEach((s) => delete next[s]);
        return next;
      });
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="CONTROLE CENTRAL"
        title="Administração"
        subtitle="Gerencie as filas de atendimento e as notícias do monitor."
      />

      <section>
        {/* ── Controle de filas ── */}
        {canManageFilas && (
          <section className={cn(sectionStyle, 'mt-0')}>
            <div className={sectionTitleStyle}>
              <div>
                <p className={sectionEyebrowStyle}>FILAS POR SERVIÇO</p>
                <h2 className={`font-bold ${sectionHeadingStyle}`}>
                  Controle dos atendimentos
                </h2>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
              {Object.values(SECTORS)
                .filter((item) => canAccessSector(session, item.id, 'read'))
                .map((item) => {
                  const queue = normalizeQueue(state[item.id]);
                  const isReset = resettingSector[item.id];
                  const canResetSector =
                    canReset && canAccessSector(session, item.id, 'write');
                  return (
                    <article
                      key={item.id}
                      className="flex flex-col justify-between gap-3 rounded-[8px] border border-[#e1ebee] p-4.5 lg:flex-row"
                    >
                      <div>
                        <strong className="block">{item.name}</strong>
                        <small className="mt-2 block text-[11px] text-[#7a919e]">
                          Normal:{' '}
                          {queue.normalCurrent === null ||
                          queue.normalCurrent === undefined
                            ? 'N---'
                            : `N${String(queue.normalCurrent).padStart(3, '0')}`}{' '}
                          · Preferencial:{' '}
                          {queue.priorityCurrent === null ||
                          queue.priorityCurrent === undefined
                            ? 'P---'
                            : `P${String(queue.priorityCurrent).padStart(3, '0')}`}
                        </small>
                      </div>
                      <div className="flex flex-col gap-2">
                        <Link
                          href={`/monitor/${item.id}`}
                          target="_blank"
                          className={cn(
                            buttonVariants({ size: 'sm', variant: 'outline' }),
                          )}
                        >
                          <Monitor data-icon="inline-start" /> Abrir Monitor
                        </Link>

                        {canResetSector && (
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => setResetPending(item.id)}
                            disabled={isReset}
                          >
                            <RotateCcw data-icon="inline-start" />
                            {isReset ? 'Resetando…' : 'Resetar senhas'}
                          </Button>
                        )}
                      </div>
                    </article>
                  );
                })}
            </div>

            {canReset && canManageAllSectors && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-[8px] border border-[#f5d9b8] bg-[#fff8f0] px-4.5 py-4">
                <div className="flex min-w-50 flex-1 items-center gap-2.5 text-[12px] leading-normal text-[#7a4a1e]">
                  <AlertTriangle
                    size={16}
                    className="shrink-0 text-[#c97a1e]"
                  />
                  <span>
                    Resetar todos os setores de uma vez — numeração volta para{' '}
                    {MIN_QUEUE_NUMBER.toString().padStart(3, '0')} em todos.
                  </span>
                </div>
                <Button
                  variant="destructive"
                  onClick={() => setResetPending('all')}
                  disabled={Object.keys(resettingSector).length > 0}
                >
                  <RotateCcw data-icon="inline-start" />
                  {Object.keys(resettingSector).length > 0
                    ? 'Resetando…'
                    : 'Resetar todos os setores'}
                </Button>
              </div>
            )}
          </section>
        )}

        {/* ── Sincronizar senhas ── */}
        {canManageFilas && <SyncSection session={session} canSync={canSync} />}

        {/* ── Notícias do monitor ── */}
        {canManageNews && (
          <NewsSection canCreate={canCreateNews} canDelete={canDeleteNews} />
        )}

        {/* ── Gerenciamento de usuários e permissões ── */}
        {canManageUsers && <AccessSection />}

        {/* Confirmação do reset — o antigo `window.confirm` */}
        <AlertDialog
          open={resetPending !== null}
          onOpenChange={(open) => {
            if (!open) setResetPending(null);
          }}
        >
          <AlertDialogContent size="sm">
            <AlertDialogHeader>
              <AlertDialogMedia className="bg-destructive/10 text-destructive">
                <Trash2Icon />
              </AlertDialogMedia>
              <AlertDialogTitle>
                {resetIsAll
                  ? 'Zerar as senhas de todos os setores?'
                  : `Zerar as senhas do setor "${resetLabel}"?`}
              </AlertDialogTitle>
              <AlertDialogDescription className="flex flex-col whitespace-pre-line">
                A numeração voltará para{' '}
                {MIN_QUEUE_NUMBER.toString().padStart(3, '0')}.
                <small className="mt-1">
                  Esta ação não poderá ser desfeita.
                </small>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => void confirmReset()}
              >
                Resetar
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </section>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════
   SEÇÃO DE SINCRONIZAÇÃO DE SENHAS
═══════════════════════════════════════════════════════════ */
interface SyncSectionProps {
  readonly canSync: boolean;
  readonly session: User;
}

function SyncSection({ canSync, session }: SyncSectionProps) {
  const [syncSector, setSyncSector] = useState(DEFAULT_SECTOR);
  // Vem do Select (valor cru da lib) e vai para `normalizeCallType`, que
  // aceita `string` — por isso `string` e não `CallType`.
  const [syncType, setSyncType] = useState<string>(CALL_TYPES.NORMAL);
  const [syncNumber, setSyncNumber] = useState('');
  const [syncing, setSyncing] = useState(false);
  // Alvo da sincronização pendente de confirmação; null = diálogo fechado.
  const [syncPending, setSyncPending] = useState<{
    readonly nextNumber: number;
    readonly sector: string;
    readonly type: string;
  } | null>(null);

  // Setores operáveis por esta sessão (escopo de escrita)
  const syncSectors = Object.values(SECTORS).filter((s) =>
    canAccessSector(session, s.id, 'write'),
  );

  // Prévia exibida no diálogo de confirmação.
  const pendingSector = syncPending ? getSector(syncPending.sector) : undefined;
  const pendingType = syncPending
    ? normalizeCallType(syncPending.type)
    : undefined;
  const pendingNumberStr =
    syncPending && pendingType
      ? formatNumberString(syncPending.nextNumber, pendingType.callType)
      : '';
  const pendingSectorName =
    pendingSector?.name ?? syncPending?.sector ?? 'setor selecionado';

  function handleSync(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const num = Number.parseInt(syncNumber, 10);
    if (!num || num < 1 || num > MAX_QUEUE_NUMBER) {
      toast.add({ title: 'Use um número entre 1 e 999.', type: 'error' });
      return;
    }

    // O envio só acontece depois da confirmação explícita.
    setSyncPending({
      nextNumber: num,
      sector: syncSector,
      type: syncType,
    });
  }

  async function confirmSync() {
    const pending = syncPending;
    if (!pending) return;
    setSyncPending(null);
    setSyncing(true);

    try {
      const res = await fetch('/api/queue/sync', {
        body: JSON.stringify({
          nextNumber: pending.nextNumber,
          sector: pending.sector,
          type: pending.type,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });
      const data = await readJson<QueueSyncBody>(res);

      if (!res.ok) throw new Error(data.error);

      toast.add({
        title: data.message || `Próxima senha: ${data.numberStr}`,
        type: 'success',
      });
      setSyncNumber('');
    } catch (error) {
      toast.add({
        title: errorMessage(error, 'Erro ao sincronizar senha.'),
        type: 'error',
      });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className={sectionStyle}>
      <div className={sectionTitleStyle}>
        <div>
          <p className={sectionEyebrowStyle}>CONTROLE</p>
          <h2 className={`font-bold ${sectionHeadingStyle}`}>
            Sincronizar senhas
          </h2>
        </div>
      </div>

      <p className="mb-4 text-[13px] leading-normal text-[#5a7a8a]">
        Pule para um número específico de senha. Útil quando senhas são perdidas
        ou não aparecem nos monitores.
      </p>

      {!canSync && (
        <Alert variant="destructive" className="mb-4">
          <AlertTriangle />
          <AlertTitle>Permissão ausente</AlertTitle>
          <AlertDescription>
            Sua sessão não tem a permissão <strong>filas.sincronizar</strong>.
          </AlertDescription>
        </Alert>
      )}

      {canSync && (
        <form className="mt-4" onSubmit={(e) => void handleSync(e)}>
          <div className="grid grid-cols-1 items-end gap-3 lg:grid-cols-[1fr_1fr_1fr_auto]">
            <FilterGroup label="Setor">
              <Select
                value={syncSector}
                onValueChange={(v) => v !== null && setSyncSector(v)}
                items={Object.fromEntries(
                  syncSectors.map((s) => [s.id, s.name]),
                )}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Setores</SelectLabel>

                    {syncSectors.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FilterGroup>

            <FilterGroup label="Tipo">
              <Select
                value={syncType}
                onValueChange={(v) => v !== null && setSyncType(v)}
                items={{
                  [CALL_TYPES.NORMAL]: 'Normal',
                  [CALL_TYPES.PREFERENCIAL]: 'Preferencial',
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Tipos de Fila</SelectLabel>
                    <SelectItem value={CALL_TYPES.NORMAL}>Normal</SelectItem>
                    <SelectItem value={CALL_TYPES.PREFERENCIAL}>
                      Preferencial
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </FilterGroup>

            <FilterGroup label="Próximo número">
              <Input
                type="number"
                min="1"
                max="999"
                value={syncNumber}
                onChange={(e) => setSyncNumber(e.target.value)}
                placeholder="Ex: 045"
                required
              />
            </FilterGroup>

            <Button
              type="submit"
              disabled={syncing || !syncNumber}
              className="mb-px self-end"
            >
              {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </Button>
          </div>
        </form>
      )}

      <AlertDialog
        open={syncPending !== null}
        onOpenChange={(open) => {
          if (!open) setSyncPending(null);
        }}
      >
        <AlertDialogContent size="default">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-primary/10 text-primary">
              <RotateCcw />
            </AlertDialogMedia>
            <AlertDialogTitle>
              Sincronizar a fila de &quot;{pendingSectorName}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-3">
              <span>
                A numeração será ajustada para que a{' '}
                <strong>próxima senha chamada</strong> seja a indicada abaixo.
              </span>

              <span className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-muted/60 p-3 text-left text-foreground">
                <span className="text-muted-foreground">Setor</span>
                <span className="font-medium">{pendingSectorName}</span>

                <span className="text-muted-foreground">Tipo</span>
                <span className="font-medium">
                  {pendingType?.sequenceType === CALL_TYPES.PREFERENCIAL
                    ? 'Preferencial'
                    : 'Normal'}
                </span>

                <span className="text-muted-foreground">Novo número</span>
                <span className="font-heading text-base font-semibold tabular-nums">
                  {pendingNumberStr}
                </span>
              </span>

              <span>
                Somente a sequência deste setor e tipo é alterada. As senhas já
                chamadas e o histórico permanecem intactos; as chamadas
                seguintes continuam a partir do novo número.
              </span>

              <small className="text-xs">
                Esta ação não poderá ser desfeita. Confira o setor e o número
                antes de continuar.
              </small>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              disabled={syncing}
              onClick={() => void confirmSync()}
            >
              {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
