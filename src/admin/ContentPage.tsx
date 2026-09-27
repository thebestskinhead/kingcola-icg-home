import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ImageField, ImageThumb } from './ImageField'
import {
  RESOURCES,
  defaultEntity,
  isFieldActive,
  isResourceKey,
  validateEntity,
  type FieldDef,
  type ResourceDef,
} from '@shared/resources'
import { adminDeleteContent, adminCreateContent, adminUpdateContent, adminListContent } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/utils'
import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

type Entity = Record<string, unknown>

/** 单个字段的编辑控件，按 FieldDef.type 分发 */
function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDef
  value: unknown
  onChange: (next: unknown) => void
}) {
  switch (field.type) {
    case 'image':
      return (
        <ImageField value={value} onChange={onChange} scope={field.scope} shape={field.preview ?? 'square'} />
      )
    case 'textarea':
      return (
        <Textarea
          value={String(value ?? '')}
          rows={field.key === 'content' ? 8 : 3}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'select':
      return (
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {field.optionLabels?.[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'switch':
      return (
        <div className="flex h-9 items-center">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
          <span className="ml-2.5 text-sm text-muted-foreground">{value ? '是' : '否'}</span>
        </div>
      )
    case 'number':
      return (
        <Input
          type="number"
          value={String(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )
    case 'date':
      return <Input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'tags':
      return (
        <Input
          value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
          placeholder={field.placeholder ?? '用逗号分隔'}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    default:
      return (
        <Input
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** 表格单元格展示 */
function CellValue({ field, entity }: { field: FieldDef; entity: Entity }) {
  const value = entity[field.key]
  if (field.type === 'image') {
    return (
      <ImageThumb
        src={typeof value === 'string' ? value : ''}
        alt={String(entity.name ?? entity.title ?? '')}
        className={cn(field.preview === 'circle' && 'rounded-full', field.preview === 'wide' && 'w-16')}
      />
    )
  }
  if (field.type === 'switch') {
    return (
      <span className={value ? 'text-emerald-600' : 'text-muted-foreground'}>{value ? '是' : '否'}</span>
    )
  }
  if (field.type === 'select' && (field.options ?? []).includes('current')) {
    return (
      <span className={cn('rounded-full px-2 py-0.5 text-xs', value === 'current' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-secondary text-muted-foreground')}>
        {value === 'current' ? '在组' : '已毕业'}
      </span>
    )
  }
  if (field.type === 'tags') {
    const tags = Array.isArray(value) ? value : []
    return (
      <span className="flex flex-wrap gap-1">
        {tags.slice(0, 3).map((t) => (
          <span key={String(t)} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
            {String(t)}
          </span>
        ))}
      </span>
    )
  }
  const text =
    field.type === 'select'
      ? (field.optionLabels?.[String(value ?? '')] ?? String(value ?? ''))
      : String(value ?? '')
  return (
    <span className={cn('block truncate', field.compact ? 'max-w-[8rem]' : 'max-w-[22rem]')} title={text}>
      {text || <span className="text-muted-foreground">—</span>}
    </span>
  )
}

export function ContentPage() {
  const { resource } = useParams<{ resource: string }>()
  const def: ResourceDef | null = resource && isResourceKey(resource) ? RESOURCES[resource] : null

  const [items, setItems] = useState<Entity[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Entity | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Entity | null>(null)
  const [saving, setSaving] = useState(false)

  const listFields = useMemo(() => (def ? def.fields.filter((f) => f.inList) : []), [def])

  const load = useCallback(async () => {
    if (!def) return
    setLoading(true)
    try {
      const response = await adminListContent(def.key, { q: search || undefined })
      setItems(response.items as Entity[])
      setTotal(response.total)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [def, search])

  useEffect(() => {
    void load()
  }, [load])

  if (!def) return <Navigate to="/admin" replace />

  const openCreate = () => {
    setEditingId(null)
    setDraft(defaultEntity(def))
  }

  const openEdit = (entity: Entity) => {
    setEditingId(String(entity.id))
    const next: Entity = {}
    for (const field of def.fields) {
      const value = entity[field.key]
      next[field.key] = field.type === 'tags' && Array.isArray(value) ? value.join(', ') : (value ?? '')
    }
    setDraft(next)
  }

  const save = async () => {
    if (!draft) return
    const payload: Entity = {}
    for (const field of def.fields) {
      const value = draft[field.key]
      payload[field.key] =
        field.type === 'tags'
          ? String(value ?? '')
              .split(/[,，、]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : value
    }

    // 提交前先跑一遍与 Worker 完全相同的校验（同一个 validateEntity）：
    // 「新增 / 编辑」时所有必填字段（含按 status 切换的负责方向 / 毕业去向）都必须已填写，
    // 本地先拦一次，免得白跑一趟接口才拿到 400。
    const invalid = validateEntity(def, payload)
    if (invalid) {
      toast.error(invalid)
      return
    }

    setSaving(true)
    try {
      if (editingId) {
        await adminUpdateContent(def.key, editingId, payload)
        toast.success('已保存修改')
      } else {
        await adminCreateContent(def.key, payload)
        toast.success(`已新增${def.singular}`)
      }
      setDraft(null)
      setEditingId(null)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await adminDeleteContent(def.key, String(deleting.id))
      toast.success('已删除')
      setDeleting(null)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '删除失败')
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{def.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {def.description} · 共 {total} 条
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索…"
              className="w-44 pl-8"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} title="刷新">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> 新增{def.singular}
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">#</TableHead>
              {listFields.map((field) => (
                <TableHead key={field.key}>{field.label}</TableHead>
              ))}
              <TableHead className="w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((entity, index) => (
              <TableRow key={String(entity.id)}>
                <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                {listFields.map((field) => (
                  <TableCell key={field.key}>
                    <CellValue field={field} entity={entity} />
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => openEdit(entity)}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                      title="编辑"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleting(entity)}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && items.length === 0 && (
              <TableRow>
                <TableCell colSpan={listFields.length + 2} className="py-14 text-center text-sm text-muted-foreground">
                  暂无数据
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell colSpan={listFields.length + 2} className="py-14 text-center text-sm text-muted-foreground">
                  加载中…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ===== 新增 / 编辑 ===== */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingId ? `编辑${def.singular}` : `新增${def.singular}`}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="grid gap-4 py-2">
              {def.fields
                // showWhen：按另一个字段的取值决定是否显示（如「在组」只填负责方向、轮播的图片只在图片版显示）
                .filter((field) => isFieldActive(field, draft))
                .map((field) => (
                  <div key={field.key} className="grid gap-1.5">
                    <Label>
                      {field.label}
                      {/* requiredWhen 的字段只在该条件成立时才渲染（上面已用 isFieldActive 过滤过），
                          所以这里直接按「有 requiredWhen 即此时必填」标注星号 */}
                      {(field.required || field.requiredWhen) && (
                        <span className="ml-0.5 text-destructive">*</span>
                      )}
                    </Label>
                    <FieldControl
                      field={field}
                      value={draft[field.key]}
                      onChange={(next) => setDraft({ ...draft, [field.key]: next })}
                    />
                    {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
                  </div>
                ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : editingId ? '保存修改' : '确认新增'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 删除确认 ===== */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该{def.singular}？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{String(deleting?.name ?? deleting?.title ?? deleting?.kicker ?? '')}」，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
