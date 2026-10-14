'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 悬停/聚焦显示的小问号浮窗（无第三方依赖，跟随主题变量）。
 * 用于「CF Token 怎么拿」这类一次性操作说明。
 *
 * 交互：悬停或键盘聚焦即显示；点击可固定（移动端友好）；Esc / 点击别处关闭。
 * 浮窗**向下**弹出并限高可滚动 —— 向上弹时若锚点靠页面顶部，内容会超出文档上边界、
 * 滚不上去看不到（实机踩到的 bug，别再改回 bottom）。
 */
export default function HelpTip({ label = '帮助', children }: { label?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false)
        setPinned(false)
      }
    }
    function onClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
        setPinned(false)
      }
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClickOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClickOutside)
    }
  }, [open])

  return (
    <span
      className="help-tip"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (!pinned) setOpen(false)
      }}
    >
      <button
        type="button"
        className="help-tip-btn"
        aria-label={label}
        aria-expanded={open}
        title={label}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!pinned) setOpen(false)
        }}
        onClick={() => {
          setPinned((p) => !p)
          setOpen((v) => !v)
        }}
      >
        ?
      </button>
      {open && (
        <span className="help-tip-bubble" role="tooltip">
          {children}
        </span>
      )}
    </span>
  )
}
