import { useState } from 'react'

import { apiUrl, requestJson } from '@/shared/api'
import { useQuery } from '@/shared/query'

import type { Application, ApplicationVersion } from '../model'

interface Finding {
  id: string
  rule: string
  severity: string
  message: string
  page: number | null
  bbox?: [number, number, number, number] | null
}
interface Sheets {
  state: string
  documents: Array<{
    index: number
    name: string
    pages: Array<{ index: number; number: number; width: number; height: number; kind_title: string; notes?: string[] }>
    findings: Finding[]
  }>
}

export function ApplicationSheetViewer({ application, version }: {
  application: Application
  version?: ApplicationVersion
}) {
  const [fileIndex, setFileIndex] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [selected, setSelected] = useState<string>()
  const [zoom, setZoom] = useState(1)
  const [imageError, setImageError] = useState(false)
  const path = version
    ? `/applications/${application.id}/versions/${version.id}/sheets`
    : `/applications/${application.id}/sheets`
  const query = useQuery({
    queryKey: ['applications', application.id, 'sheets', version?.id ?? 'submitted', application.submittedVersionId],
    queryFn: () => requestJson<Sheets>(apiUrl(path)),
    refetchInterval: query => query.state.data?.state === 'done' ? false : 2000,
  })
  const documents = query.data?.documents ?? []
  const document = documents.find(doc => doc.index === fileIndex) ?? documents[0]
  const pages = document?.pages ?? []
  const page = pages.find(page => page.index === pageIndex) ?? pages[0]
  const position = page ? pages.indexOf(page) : 0
  const imageUrl = page && document ? apiUrl(`${path}?file=${document.index}&page=${page.index}`) : undefined
  const changePage = (index: number) => { setPageIndex(index); setSelected(undefined); setImageError(false) }
  const selectFinding = (finding: Finding) => {
    setSelected(finding.id)
    if (finding.page !== null) setPageIndex(finding.page)
    setImageError(false)
  }

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col gap-2 rounded-xl border bg-muted/20 p-3" aria-label="Листы документа">
      <header className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <span className="font-medium">Листы документа</span>
        {documents.length > 1 && <select aria-label="Документ пакета" value={document?.index ?? 0}
          className="min-w-0 flex-1 truncate rounded-md border bg-background p-1"
          onChange={event => { setFileIndex(Number(event.target.value)); changePage(0); setZoom(1) }}>
          {documents.map(doc => <option key={doc.index} value={doc.index}>{doc.name}</option>)}
        </select>}
        {page && <>
          <button type="button" aria-label="Предыдущий лист" disabled={position === 0} className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => changePage(pages[position - 1].index)}>‹</button>
          <select aria-label="Лист документа" value={page.index} className="min-w-0 max-w-52 rounded border bg-background p-1" onChange={event => changePage(Number(event.target.value))}>
            {pages.map(p => <option key={p.index} value={p.index}>Лист {p.number} из {pages.length} · {p.kind_title}</option>)}
          </select>
          <button type="button" aria-label="Следующий лист" disabled={position === pages.length - 1} className="rounded border px-2 py-1 disabled:opacity-30" onClick={() => changePage(pages[position + 1].index)}>›</button>
          <button type="button" className="ml-auto rounded border px-2 py-1" onClick={() => setZoom(zoom === 2 ? 1 : zoom + 0.5)}>{zoom === 2 ? 'Вписать' : `Увеличить · ${Math.round(zoom * 100)}%`}</button>
        </>}
      </header>
      {query.isError ? <div className="grid min-h-0 flex-1 place-content-center gap-2 text-center text-sm">
        <p>Не удалось загрузить листы</p><button type="button" className="underline" onClick={() => void query.refetch()}>Повторить</button>
      </div> : !page ? <p className="grid min-h-0 flex-1 place-content-center text-center text-sm text-muted-foreground">{query.data?.state === 'done' ? 'В отчёте нет доступных изображений листов' : 'Подготавливаем изображения листов…'}</p> : <>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg bg-muted/40">
          {imageError ? <div className="p-4 text-sm">Не удалось загрузить изображение. <button type="button" className="underline" onClick={() => setImageError(false)}>Повторить</button></div> : <svg
            key={imageUrl} role="img" aria-label={`Лист ${page.number}: ${page.kind_title}`}
            viewBox={`0 0 ${page.width} ${page.height}`} preserveAspectRatio="xMidYMid meet"
            style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%`, minHeight: '100%' }}>
            <image href={imageUrl} width={page.width} height={page.height} onError={() => setImageError(true)} />
            {document?.findings.filter(f => f.page === page.index && f.bbox).map(f => {
              const [x0, y0, x1, y1] = f.bbox!
              const active = f.id === selected
              return <g key={f.id} role="button" tabIndex={0} aria-label={f.message}
                className="cursor-pointer" onClick={() => selectFinding(f)}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); selectFinding(f) } }}>
                <title>{f.message}</title>
                <rect x={x0 - 4} y={y0 - 4} width={x1 - x0 + 8} height={y1 - y0 + 8}
                  fill={active ? '#ef444433' : '#f59e0b18'} stroke={f.severity === 'error' ? '#ef4444' : '#f59e0b'} strokeWidth={active ? 3 : 1.5} vectorEffect="non-scaling-stroke" />
                <text x={x0 - 4} y={y0 - 8} fontSize={12} fill={f.severity === 'error' ? '#dc2626' : '#b45309'}>{f.rule}</text>
              </g>
            })}
          </svg>}
        </div>
        {Boolean(document?.findings.length) && <select aria-label="Перейти к замечанию на листе" className="w-full shrink-0 truncate rounded border bg-background p-1 text-sm" value={selected ?? ''}
          onChange={event => { const finding = document?.findings.find(f => f.id === event.target.value); if (finding) selectFinding(finding) }}>
          <option value="">Замечания на листах — выберите для перехода</option>
          {document?.findings.map(f => <option key={f.id} value={f.id}>{f.page !== null ? `Лист ${f.page + 1}: ` : ''}{f.message}</option>)}
        </select>}
        {selected && <p className="line-clamp-2 shrink-0 text-xs">{document?.findings.find(f => f.id === selected)?.message}</p>}
        {page.notes?.length ? <p className="line-clamp-2 shrink-0 text-xs text-muted-foreground">{page.notes.join(' ')}</p> : null}
      </>}
    </section>
  )
}
