'use client';

import type {
  NewsCreateBody,
  NewsListBody,
  NewsUpdateBody,
  SuccessBody,
} from '@/shared/types/api';
import type {
  NewsCounts,
  NewsItem,
  NewsPage,
  NewsPagination,
} from '@/shared/types/domain';

import {
  AlertTriangle,
  EyeOff,
  ImageIcon,
  ImagePlus,
  Loader2,
  RotateCcw,
  Trash2,
  Trash2Icon,
  Upload,
} from 'lucide-react';
import Image from 'next/image';
import {
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  sectionEyebrowStyle,
  sectionHeadingStyle,
  sectionStyle,
  sectionTitleStyle,
} from '@/app/(authenticated)/(dashboard)/admin/admin-styles';
import { notifyNewsChanged } from '@/client/news/news-events';
import { cn } from '@/client/utils';
import { Pagination } from '@/components/pagination';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import {
  isNewsStatus,
  NEWS_MAX_ACTIVE,
  NEWS_MAX_FILE_SIZE,
  NEWS_PAGE_SIZE,
  NEWS_STATUSES,
  NEWS_TITLE_MAX,
  type NewsStatus,
} from '@/shared/constants';
import { errorMessage } from '@/shared/errors';
import { readJson } from '@/shared/json';
import { formatDateTime } from '@/shared/time';
import { isAllowedImageType, isValidFileSize } from '@/shared/validation';

/** Ação que ficou pendente por causa do limite de ativas. */
type PendingLimitAction =
  | { readonly id: string; readonly kind: 'restore' }
  | { readonly title: string; readonly file: File; readonly kind: 'create' };

interface NewsSectionProps {
  readonly canCreate: boolean;
  readonly canDelete: boolean;
}

interface PreviewDimensions {
  readonly height: number;
  readonly width: number;
}

const EMPTY_COUNTS: NewsCounts = { active: 0, inactive: 0 };
const EMPTY_PAGINATION: NewsPagination = {
  page: 1,
  pageSize: NEWS_PAGE_SIZE,
  total: 0,
  totalPages: 1,
};

/**
 * Seção "Notícias do monitor".
 *
 * Cada ação é imediata (publicar, inativar, reativar, excluir) — não existe
 * mais o rascunho local nem o "Salvar notícias", que publicava em lote e
 * deixava o servidor parcialmente atualizado quando um item falhava.
 */
export function NewsSection({ canCreate, canDelete }: NewsSectionProps) {
  const [status, setStatus] = useState<NewsStatus>(NEWS_STATUSES.ACTIVE);
  const [items, setItems] = useState<NewsItem[]>([]);
  const [counts, setCounts] = useState(EMPTY_COUNTS);
  const [pagination, setPagination] = useState(EMPTY_PAGINATION);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<null | string>(null);

  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<null | string>(null);
  const [dimensions, setDimensions] = useState<PreviewDimensions | null>(null);
  const [formError, setFormError] = useState<null | string>(null);
  const [fileError, setFileError] = useState<null | string>(null);
  const [dragging, setDragging] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [archiveTarget, setArchiveTarget] = useState<NewsItem | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<NewsItem | null>(null);
  const [previewTarget, setPreviewTarget] = useState<NewsItem | null>(null);

  const [limitOpen, setLimitOpen] = useState(false);
  const [limitLoading, setLimitLoading] = useState(false);
  const [limitItems, setLimitItems] = useState<NewsItem[]>([]);
  const [limitBusyId, setLimitBusyId] = useState<null | string>(null);
  const [pendingAction, setPendingAction] = useState<PendingLimitAction | null>(
    null,
  );

  const requestRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewUrlRef = useRef<null | string>(null);

  const fetchPage = useCallback(
    (targetStatus: NewsStatus, targetPage: number) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(NEWS_PAGE_SIZE),
        status: targetStatus,
      });

      fetch(`/api/news?${params}`, { signal: controller.signal })
        .then((response) =>
          response.ok ? readJson<NewsListBody>(response) : null,
        )
        .then((data) => {
          if (controller.signal.aborted) return;

          const page = toNewsPage(data);
          if (!page) {
            toast.add({
              title:
                'O servidor respondeu num formato inesperado. Recarregue a página.',
              type: 'error',
            });
            return;
          }

          setItems(page.items);
          setCounts(page.counts);
          setPagination(page.pagination);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    },
    [],
  );

  /**
   * Carrega exibindo "Carregando…" na hora.
   *
   * Fica separado do `fetchPage` porque o effect da carga inicial não pode
   * chamar `setState` de forma síncrona (regra `set-state-in-effect`) — nesse
   * primeiro render `loading` já nasce `true`.
   */
  const load = useCallback(
    (targetStatus: NewsStatus, targetPage: number) => {
      setLoading(true);
      fetchPage(targetStatus, targetPage);
    },
    [fetchPage],
  );

  useEffect(() => {
    fetchPage(NEWS_STATUSES.ACTIVE, 1);
  }, [fetchPage]);

  useEffect(() => () => requestRef.current?.abort(), []);

  // Revoga a URL do preview anterior (troca de arquivo) e a do unmount.
  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const limitReached = counts.active >= NEWS_MAX_ACTIVE;

  /* ── Listagem ── */

  function changeStatus(next: NewsStatus) {
    if (next === status) return;
    setStatus(next);
    load(next, 1);
  }

  function changePage(next: number) {
    load(status, next);
  }

  /* ── Formulário de upload ── */

  function clearFile() {
    previewUrlRef.current = null;
    setFile(null);
    setPreviewUrl(null);
    setDimensions(null);
    setFileError(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  function selectFile(next: File) {
    if (!isAllowedImageType(next.type)) {
      setFileError('Formato inválido. Use JPG, PNG, WEBP, GIF ou AVIF.');
      return;
    }
    if (!isValidFileSize(next.size)) {
      setFileError(
        `A imagem deve ter no máximo ${formatBytes(NEWS_MAX_FILE_SIZE)}.`,
      );
      return;
    }

    setFileError(null);
    setFormError(null);
    setFile(next);

    const url = URL.createObjectURL(next);
    previewUrlRef.current = url;
    setPreviewUrl(url);
    setDimensions(null);

    const image = new window.Image();
    image.onload = () => {
      if (previewUrlRef.current !== url) return;
      setDimensions({
        height: image.naturalHeight,
        width: image.naturalWidth,
      });
    };
    image.src = url;
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) selectFile(dropped);
  }

  function handlePaste(event: ClipboardEvent<HTMLFormElement>) {
    const pasted = event.clipboardData.files?.[0];
    if (!pasted) return;
    event.preventDefault();
    selectFile(pasted);
  }

  async function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      setFormError('Informe um título.');
      return;
    }
    if (trimmedTitle.length > NEWS_TITLE_MAX) {
      setFormError(`O título deve ter no máximo ${NEWS_TITLE_MAX} caracteres.`);
      return;
    }
    if (!file) {
      setFileError('Selecione uma imagem.');
      return;
    }
    if (limitReached) {
      setPendingAction({
        title: trimmedTitle,
        file,
        kind: 'create',
      });
      void openLimitDialog();
      return;
    }

    setFormError(null);
    await publish(trimmedTitle, file);
  }

  async function publish(nextTitle: string, nextFile: File) {
    setPublishing(true);
    try {
      const formData = new FormData();
      formData.append('title', nextTitle);
      formData.append('image', nextFile);

      const response = await fetch('/api/news', {
        body: formData,
        method: 'POST',
      });
      const data = await readJson<NewsCreateBody>(response);

      if (!response.ok) {
        if (response.status === 409) {
          setPendingAction({
            title: nextTitle,
            file: nextFile,
            kind: 'create',
          });
          void openLimitDialog();
          return;
        }
        throw new Error(data.error);
      }

      setTitle('');
      clearFile();
      setStatus(NEWS_STATUSES.ACTIVE);
      load(NEWS_STATUSES.ACTIVE, 1);
      notifyNewsChanged();
      toast.add({
        title: 'Notícia publicada no monitor.',
        type: 'success',
      });
    } catch (error) {
      toast.add({
        title: errorMessage(error, 'Não foi possível publicar a notícia.'),
        type: 'error',
      });
    } finally {
      setPublishing(false);
    }
  }

  /* ── Arquivar / reativar / excluir ── */

  async function setActiveById(id: string, active: boolean) {
    setBusyId(id);
    try {
      const response = await fetch('/api/news', {
        body: JSON.stringify({ id, active }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      });
      const data = await readJson<NewsUpdateBody>(response);

      if (!response.ok) {
        if (response.status === 409 && active) {
          setPendingAction({ id, kind: 'restore' });
          void openLimitDialog();
          return;
        }
        throw new Error(data.error);
      }

      notifyNewsChanged();
      load(status, pagination.page);
      toast.add(
        active
          ? { title: 'Notícia reativada no monitor.', type: 'success' }
          : {
              title:
                'Notícia inativada. Ela continua disponível na aba Inativas.',
              type: 'success',
            },
      );
    } catch (error) {
      toast.add({
        title: errorMessage(
          error,
          active
            ? 'Não foi possível reativar a notícia.'
            : 'Não foi possível inativar a notícia.',
        ),
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmArchive() {
    const target = archiveTarget;
    if (!target) return;
    setArchiveTarget(null);
    await setActiveById(target.id, false);
  }

  async function deleteItem(id: string) {
    setBusyId(id);
    try {
      const response = await fetch(`/api/news?id=${id}`, {
        method: 'DELETE',
      });
      const data = await readJson<SuccessBody>(response);
      if (!response.ok) throw new Error(data.error);

      notifyNewsChanged();
      load(status, pagination.page);
      toast.add({
        title: 'Notícia e imagem excluídas definitivamente.',
        type: 'success',
      });
    } catch (error) {
      toast.add({
        title: errorMessage(error, 'Não foi possível excluir a notícia.'),
        type: 'error',
      });
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    await deleteItem(target.id);
  }

  /* ── Gerenciador de ativas (limite) ── */

  async function openLimitDialog() {
    setLimitOpen(true);
    setLimitLoading(true);
    try {
      const params = new URLSearchParams({
        page: '1',
        pageSize: String(NEWS_MAX_ACTIVE),
        status: NEWS_STATUSES.ACTIVE,
      });
      const response = await fetch(`/api/news?${params}`);
      const data = await readJson<NewsListBody>(response);
      if (!response.ok) throw new Error(data.error);
      setLimitItems(toNewsPage(data)?.items ?? []);
    } catch (error) {
      toast.add({
        title: errorMessage(
          error,
          'Não foi possível carregar as notícias ativas.',
        ),
        type: 'error',
      });
    } finally {
      setLimitLoading(false);
    }
  }

  function closeLimitDialog() {
    setLimitOpen(false);
    setPendingAction(null);
  }

  async function freeSlot(item: NewsItem) {
    setLimitBusyId(item.id);
    const pending = pendingAction;

    try {
      const response = await fetch('/api/news', {
        body: JSON.stringify({ id: item.id, active: false }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      });
      const data = await readJson<NewsUpdateBody>(response);
      if (!response.ok) throw new Error(data.error);

      setLimitItems((previous) =>
        previous.filter((active) => active.id !== item.id),
      );
      setLimitOpen(false);
      setPendingAction(null);
      notifyNewsChanged();
      load(status, pagination.page);

      if (pending?.kind === 'create') {
        await publish(pending.title, pending.file);
      } else if (pending?.kind === 'restore') {
        await setActiveById(pending.id, true);
      } else {
        toast.add({
          title: 'Notícia inativada. Uma vaga foi liberada.',
          type: 'success',
        });
      }
    } catch (error) {
      toast.add({
        title: errorMessage(error, 'Não foi possível inativar a notícia.'),
        type: 'error',
      });
    } finally {
      setLimitBusyId(null);
    }
  }

  /* ── Render ── */

  let emptyMessage = 'Nenhuma notícia ativa. Publique a primeira acima.';
  if (status === NEWS_STATUSES.INACTIVE) {
    emptyMessage = 'Nenhuma notícia inativa. O que for inativado aparece aqui.';
  }

  return (
    <section className={sectionStyle}>
      <div className={sectionTitleStyle}>
        <div>
          <p className={sectionEyebrowStyle}>COMUNICAÇÃO</p>
          <h2 className={`font-bold ${sectionHeadingStyle}`}>
            Notícias do monitor
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={limitReached ? 'destructive' : 'secondary'}>
            {counts.active} de {NEWS_MAX_ACTIVE} ativas
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void openLimitDialog()}
          >
            <ImageIcon data-icon="inline-start" />
            Gerenciar ativas
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <div
          aria-label="Notícias ativas no monitor"
          aria-valuemax={NEWS_MAX_ACTIVE}
          aria-valuemin={0}
          aria-valuenow={counts.active}
          className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <div
            className={cn(
              'h-full rounded-full transition-all',
              limitReached ? 'bg-destructive' : 'bg-primary',
            )}
            style={{
              width: `${Math.min(100, (counts.active / NEWS_MAX_ACTIVE) * 100)}%`,
            }}
          />
        </div>
        <span className="text-[11px] text-muted-foreground">
          {counts.inactive} inativa(s)
        </span>
      </div>

      {limitReached && (
        <Alert className="mt-4">
          <AlertTriangle />
          <AlertTitle>Limite de notícias ativas atingido</AlertTitle>
          <AlertDescription>
            O monitor exibe no máximo {NEWS_MAX_ACTIVE} notícias. Inative uma
            notícia para liberar espaço — a imagem continua disponível em
            Inativas e pode ser reativada depois.
          </AlertDescription>
        </Alert>
      )}

      {canCreate && (
        <form
          className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_300px]"
          onPaste={handlePaste}
          onSubmit={(event) => void handlePublish(event)}
        >
          <div className="flex min-w-0 flex-col">
            <label
              className="mb-1.5 block text-[11px] font-bold tracking-[0.5px] text-[#416477] uppercase"
              htmlFor="news-title"
            >
              Título
            </label>
            <Input
              id="news-title"
              maxLength={NEWS_TITLE_MAX + 1}
              placeholder="Título da notícia"
              value={title}
              onChange={(event) => {
                setTitle(event.target.value);
                setFormError(null);
              }}
            />
            <small className="mt-1 self-end text-[10px] text-muted-foreground">
              {title.trim().length}/{NEWS_TITLE_MAX}
            </small>
            {formError && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {formError}
              </p>
            )}

            <div
              aria-describedby="news-image-help"
              className={cn(
                'mt-3 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 py-7 text-center transition-colors',
                dragging
                  ? 'border-primary bg-primary/5'
                  : 'border-input hover:bg-accent/40',
              )}
              onClick={() => inputRef.current?.click()}
              onDragLeave={() => setDragging(false)}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDrop={handleDrop}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  inputRef.current?.click();
                }
              }}
              role="button"
              tabIndex={0}
            >
              <Upload className="size-6 text-muted-foreground" />
              <span className="text-sm">
                Arraste, cole ou clique para escolher uma imagem
              </span>
              <span
                className="text-[11px] text-muted-foreground"
                id="news-image-help"
              >
                JPG, PNG, WEBP, GIF ou AVIF · até{' '}
                {formatBytes(NEWS_MAX_FILE_SIZE)}
              </span>
            </div>

            <input
              ref={inputRef}
              accept="image/*"
              className="hidden"
              type="file"
              onChange={(event) => {
                const selected = event.target.files?.[0];
                // Limpa o input para que o MESMO arquivo dispare `change` de novo.
                event.target.value = '';
                if (selected) selectFile(selected);
              }}
            />

            {fileError && (
              <p className="mt-1 text-xs text-destructive" role="alert">
                {fileError}
              </p>
            )}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <Button
                disabled={publishing || !file || !title.trim()}
                type="submit"
              >
                {publishing ? (
                  <Loader2 className="animate-spin" data-icon="inline-start" />
                ) : (
                  <ImagePlus data-icon="inline-start" />
                )}
                {publishing ? 'Publicando…' : 'Publicar notícia'}
              </Button>
              {limitReached && (
                <span className="text-[11px] text-[#8a5a12]">
                  Limite atingido: clique em publicar para escolher uma notícia
                  a inativar.
                </span>
              )}
            </div>
          </div>

          <div>
            {previewUrl ? (
              <div className="overflow-hidden rounded-lg border border-input">
                <div className="relative aspect-video w-full bg-muted">
                  <Image
                    alt="Pré-visualização da imagem selecionada"
                    className="object-cover"
                    fill
                    sizes="(max-width: 1024px) 100vw, 300px"
                    src={previewUrl}
                    unoptimized
                  />
                </div>
                <div className="space-y-0.5 p-2 text-[11px]">
                  <p className="truncate font-medium">{file?.name}</p>
                  <p className="text-muted-foreground">
                    {file ? formatBytes(file.size) : ''}
                    {dimensions
                      ? ` · ${dimensions.width}×${dimensions.height}`
                      : ''}
                  </p>
                </div>
                <div className="flex gap-1.5 border-t border-input p-2">
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => inputRef.current?.click()}
                  >
                    Trocar
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="ghost"
                    onClick={clearFile}
                  >
                    Remover
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex aspect-video w-full items-center justify-center rounded-lg border border-dashed border-input text-[11px] text-muted-foreground">
                Pré-visualização
              </div>
            )}
          </div>
        </form>
      )}

      <Tabs
        className="mt-5 w-full"
        value={status}
        onValueChange={(value) => {
          if (isNewsStatus(value)) changeStatus(value);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger className="flex-1 sm:flex-none" value="active">
              Ativas <Badge variant="secondary">{counts.active}</Badge>
            </TabsTrigger>
            <TabsTrigger className="flex-1 sm:flex-none" value="inactive">
              Inativas <Badge variant="secondary">{counts.inactive}</Badge>
            </TabsTrigger>
          </TabsList>

          <span className="text-[11px] text-muted-foreground">
            {pagination.total} {pagination.total === 1 ? 'notícia' : 'notícias'}
          </span>
        </div>

        <TabsContent className="mt-4" value={status}>
          {loading && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          )}

          {!loading && items.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {emptyMessage}
            </p>
          )}

          {!loading && items.length > 0 && (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
                {items.map((item) => (
                  <NewsCard
                    key={item.id}
                    busy={busyId === item.id}
                    canCreate={canCreate}
                    canDelete={canDelete}
                    item={item}
                    onArchive={setArchiveTarget}
                    onDelete={setDeleteTarget}
                    onPreview={setPreviewTarget}
                    onRestore={(target) => void setActiveById(target.id, true)}
                  />
                ))}
              </div>

              {pagination.totalPages > 1 && (
                <Pagination
                  page={pagination.page}
                  totalPages={pagination.totalPages}
                  onPageChange={changePage}
                />
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Confirmação de inativação */}
      <AlertDialog
        open={archiveTarget !== null}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-primary/10 text-primary">
              <EyeOff />
            </AlertDialogMedia>
            <AlertDialogTitle>Inativar esta notícia?</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col">
              {archiveTarget ? `"${archiveTarget.title}" ` : 'A notícia '}
              sairá do monitor, mas continuará disponível na aba{' '}
              <strong>Inativas</strong> e poderá ser reativada. A imagem{' '}
              <strong>não</strong> é apagada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmArchive()}>
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirmação de exclusão definitiva */}
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-destructive/10 text-destructive">
              <Trash2Icon />
            </AlertDialogMedia>
            <AlertDialogTitle>Excluir definitivamente?</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col">
              A notícia {deleteTarget ? `"${deleteTarget.title}" ` : null}
              e a imagem no servidor serão removidas. Esta ação não pode ser
              desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => void confirmDelete()}
            >
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Pré-visualização ampliada */}
      <Dialog
        open={previewTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPreviewTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewTarget?.title}</DialogTitle>
            <DialogDescription>
              {previewTarget?.createdAt
                ? formatDateTime(previewTarget.createdAt)
                : 'Data não registrada'}
              {previewTarget && !previewTarget.active
                ? ' · Inativa (fora do monitor)'
                : ''}
            </DialogDescription>
          </DialogHeader>
          {previewTarget && (
            <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
              <Image
                alt={previewTarget.title}
                className="object-contain"
                fill
                sizes="(max-width: 768px) 100vw, 768px"
                src={previewTarget.image}
                unoptimized
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Gerenciador rápido de ativas — libera uma vaga e retoma a ação pendente */}
      <Dialog
        open={limitOpen}
        onOpenChange={(open) => {
          if (!open) closeLimitDialog();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Limite de {NEWS_MAX_ACTIVE} notícias ativas
            </DialogTitle>
            <DialogDescription>
              {pendingAction
                ? 'Para concluir a ação pendente, inative uma notícia abaixo. A imagem continua na aba Inativas.'
                : 'Inative uma notícia para liberar espaço no monitor. A imagem continua na aba Inativas.'}
            </DialogDescription>
          </DialogHeader>

          {limitLoading && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Carregando…
            </p>
          )}

          {!limitLoading && limitItems.length === 0 && (
            <p className="p-6 text-center text-sm text-muted-foreground">
              Nenhuma notícia ativa encontrada.
            </p>
          )}

          {!limitLoading && limitItems.length > 0 && (
            <div className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
              {limitItems.map((item) => (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-md border border-input"
                >
                  <div className="relative aspect-video bg-muted">
                    <Image
                      alt={item.title}
                      className="object-cover"
                      fill
                      sizes="(max-width: 640px) 50vw, 200px"
                      src={item.image}
                      unoptimized
                    />
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs font-medium">{item.title}</p>
                    <Button
                      className="mt-2 w-full"
                      disabled={
                        !canDelete || limitBusyId !== null || !item.active
                      }
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => void freeSlot(item)}
                    >
                      {limitBusyId === item.id ? 'Inativando…' : 'Inativar'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!canDelete && (
            <p className="text-xs text-destructive">
              Sua sessão não tem permissão para inativar notícias. Peça a um
              administrador para liberar uma vaga.
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeLimitDialog}>
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

interface NewsCardProps {
  readonly busy: boolean;
  readonly canCreate: boolean;
  readonly canDelete: boolean;
  readonly item: NewsItem;
  readonly onArchive: (item: NewsItem) => void;
  readonly onDelete: (item: NewsItem) => void;
  readonly onPreview: (item: NewsItem) => void;
  readonly onRestore: (item: NewsItem) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function NewsCard({
  busy,
  canCreate,
  canDelete,
  item,
  onArchive,
  onDelete,
  onPreview,
  onRestore,
}: NewsCardProps) {
  return (
    <article className="overflow-hidden rounded-[7px] border border-[#e1ebee] bg-white">
      <button
        aria-label={`Pré-visualizar ${item.title}`}
        className="group relative block aspect-video w-full overflow-hidden bg-muted"
        type="button"
        onClick={() => onPreview(item)}
      >
        <Image
          alt={item.title}
          className={cn(
            'object-cover transition-transform group-hover:scale-105',
            !item.active && 'opacity-60 grayscale',
          )}
          fill
          sizes="(max-width: 768px) 50vw, 200px"
          src={item.image}
          unoptimized
        />
        <Badge
          className="absolute top-1.5 left-1.5"
          variant={item.active ? 'default' : 'secondary'}
        >
          {item.active ? 'No monitor' : 'Inativa'}
        </Badge>
      </button>

      <div className="space-y-0.5 p-[9px]">
        <strong className="block truncate text-[12px]">{item.title}</strong>
        <span className="block text-[10px] text-muted-foreground">
          {item.createdAt ? formatDateTime(item.createdAt) : '—'}
        </span>
      </div>

      {item.active && canDelete && (
        <Button
          className="h-8 w-full justify-center rounded-none border-t border-[#e1ebee]"
          disabled={busy}
          size="sm"
          variant="ghost"
          onClick={() => onArchive(item)}
        >
          <EyeOff data-icon="inline-start" />
          {busy ? 'Inativando…' : 'Inativar'}
        </Button>
      )}

      {!item.active && (
        <div className="flex border-t border-[#e1ebee]">
          {canCreate && (
            <Button
              className="h-8 flex-1 justify-center rounded-none"
              disabled={busy}
              size="sm"
              variant="ghost"
              onClick={() => onRestore(item)}
            >
              <RotateCcw data-icon="inline-start" />
              {busy ? 'Reativando…' : 'Reativar'}
            </Button>
          )}
          {canDelete && (
            <Button
              className="h-8 flex-1 justify-center rounded-none text-destructive hover:bg-[#fdecea] hover:text-destructive"
              disabled={busy}
              size="sm"
              variant="ghost"
              onClick={() => onDelete(item)}
            >
              <Trash2 data-icon="inline-start" />
              Excluir
            </Button>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * Normaliza a resposta de `GET /api/news` antes de ir para o estado.
 *
 * O `readJson` só *assume* o contrato: se a resposta vier de um servidor mais
 * antigo (ou de um handler antigo ainda em memória no dev), `counts` e
 * `pagination` podem faltar. Sem esta checagem a seção inteira quebrava em
 * `counts.active`, derrubando o admin.
 *
 * @returns `null` quando nem a lista veio — aí não há o que renderizar e quem
 * chama avisa o usuário.
 */
function toNewsPage(data: NewsListBody | null): NewsPage | null {
  if (!data || !Array.isArray(data.news)) return null;

  const items = data.news;

  return {
    counts: data.counts ?? {
      active: items.filter((item) => item.active).length,
      inactive: items.filter((item) => !item.active).length,
    },
    items,
    pagination: data.pagination ?? {
      page: 1,
      pageSize: NEWS_PAGE_SIZE,
      total: items.length,
      totalPages: 1,
    },
  };
}
