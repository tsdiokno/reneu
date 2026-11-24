import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface MultiSelectOption<T extends string | number> {
  value: T;
  label: string;
  meta?: string;
  keywords?: string;
}

export interface MultiSelectDropdownProps<T extends string | number> {
  values: T[];
  options: MultiSelectOption<T>[];
  onChange: (nextValues: T[]) => void;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  title?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
}

interface MenuPosition {
  left: number;
  width: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
}

/**
 * Reusable searchable multiselect dropdown portaled to document.body
 * so it is never clipped inside scrollable modal containers.
 */
export function MultiSelectDropdown<T extends string | number>({
  values,
  options,
  onChange,
  label,
  placeholder = 'Select items…',
  searchPlaceholder = 'Search…',
  emptyText = 'No matching options.',
  title,
  ariaLabel,
  className = '',
  disabled = false,
}: MultiSelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedSet = useMemo(() => new Set(values.map((v) => String(v))), [values]);

  const selectedOptions = useMemo(
    () => options.filter((opt) => selectedSet.has(String(opt.value))),
    [options, selectedSet]
  );

  const filteredOptions = useMemo(() => {
    const tokens = searchQuery
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (tokens.length === 0) return options;

    return options.filter((opt) => {
      const haystack = `${opt.label} ${opt.meta ?? ''} ${opt.keywords ?? ''}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
  }, [options, searchQuery]);

  const triggerSummary = useMemo(() => {
    if (selectedOptions.length === 0) return placeholder;
    if (selectedOptions.length === 1) return selectedOptions[0].label;
    if (selectedOptions.length === 2) {
      return `${selectedOptions[0].label}, ${selectedOptions[1].label}`;
    }
    return `${selectedOptions.length} selected (${selectedOptions[0].label}, ${selectedOptions[1].label}, +${selectedOptions.length - 2})`;
  }, [selectedOptions, placeholder]);

  const updatePosition = () => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const openUpward = spaceBelow < 230 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(160, Math.min(320, openUpward ? spaceAbove : spaceBelow));

    setMenuPos({
      left: Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding)),
      width: Math.min(rect.width, window.innerWidth - viewportPadding * 2),
      top: openUpward ? undefined : rect.bottom + gap,
      bottom: openUpward ? window.innerHeight - rect.top + gap : undefined,
      maxHeight: availableHeight,
    });
  };

  useLayoutEffect(() => {
    if (!isOpen) return;
    updatePosition();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      return;
    }

    const focusTimer = window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
    });

    const handlePointerDown = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setIsOpen(false);
    };

    // Capture-phase Escape so closing the dropdown does not also dismiss a parent Modal
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    const handleReposition = () => {
      updatePosition();
    };

    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('resize', handleReposition);
    window.addEventListener('scroll', handleReposition, true);

    return () => {
      window.cancelAnimationFrame(focusTimer);
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('resize', handleReposition);
      window.removeEventListener('scroll', handleReposition, true);
    };
  }, [isOpen]);

  const toggleValue = (value: T) => {
    const key = String(value);
    const nextSet = new Set(selectedSet);
    if (nextSet.has(key)) {
      nextSet.delete(key);
    } else {
      nextSet.add(key);
    }
    const nextOrdered = options.filter((opt) => nextSet.has(String(opt.value))).map((opt) => opt.value);
    onChange(nextOrdered);
  };

  const handleSelectFiltered = () => {
    const nextSet = new Set(selectedSet);
    for (const opt of filteredOptions) {
      nextSet.add(String(opt.value));
    }
    const nextOrdered = options.filter((opt) => nextSet.has(String(opt.value))).map((opt) => opt.value);
    onChange(nextOrdered);
  };

  const handleClearFiltered = () => {
    const filteredKeys = new Set(filteredOptions.map((opt) => String(opt.value)));
    const nextOrdered = options
      .filter((opt) => selectedSet.has(String(opt.value)) && !filteredKeys.has(String(opt.value)))
      .map((opt) => opt.value);
    onChange(nextOrdered);
  };

  const allFilteredSelected =
    filteredOptions.length > 0 && filteredOptions.every((opt) => selectedSet.has(String(opt.value)));
  const someFilteredSelected = filteredOptions.some((opt) => selectedSet.has(String(opt.value)));

  const menuNode =
    isOpen && menuPos && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={menuRef}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel || label || placeholder}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              left: `${menuPos.left}px`,
              width: `${menuPos.width}px`,
              top: menuPos.top !== undefined ? `${menuPos.top}px` : undefined,
              bottom: menuPos.bottom !== undefined ? `${menuPos.bottom}px` : undefined,
              maxHeight: `${menuPos.maxHeight}px`,
            }}
            className="z-[120] rounded-xl border border-[var(--line-subtle)] bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-2xl overflow-hidden flex flex-col font-sans touch-auto"
          >
            {/* Search Input Header */}
            <div className="p-2 border-b border-[var(--line-subtle)] bg-[var(--bg-surface)] shrink-0 flex flex-col gap-1.5">
              <div className="relative flex items-center">
                <svg
                  className="w-3.5 h-3.5 text-[var(--text-subtle)] absolute left-2.5 pointer-events-none"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={searchPlaceholder}
                  aria-label={searchPlaceholder}
                  className="w-full h-8 pl-8 pr-7 text-xs rounded border border-[var(--line-subtle)] bg-[var(--bg-app)]/60 text-[var(--text-primary)] placeholder:text-[var(--text-subtle)] focus:outline-none focus:border-[var(--text-primary)] transition-colors"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="absolute right-1.5 p-1 rounded text-[var(--text-subtle)] hover:text-[var(--text-primary)] cursor-pointer"
                    aria-label="Clear search"
                    title="Clear search"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              {filteredOptions.length > 0 && (searchQuery.trim().length > 0 || values.length > 0) && (
                <div className="flex items-center justify-between gap-2 px-0.5 text-[11px] text-[var(--text-subtle)]">
                  <span>
                    {searchQuery.trim()
                      ? `${filteredOptions.length} matching`
                      : `${values.length} selected`}
                  </span>
                  <div className="flex items-center gap-2">
                    {searchQuery.trim() && !allFilteredSelected && (
                      <button
                        type="button"
                        onClick={handleSelectFiltered}
                        className="hover:text-[var(--text-primary)] font-medium cursor-pointer"
                      >
                        Select shown ({filteredOptions.length})
                      </button>
                    )}
                    {someFilteredSelected && (
                      <button
                        type="button"
                        onClick={handleClearFiltered}
                        className="hover:text-rose-500 cursor-pointer"
                      >
                        {searchQuery.trim() ? 'Clear shown' : 'Clear all'}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Scrollable Options List */}
            <div className="flex-1 overflow-y-auto overscroll-contain p-1.5 flex flex-col gap-0.5">
              {filteredOptions.length === 0 ? (
                <div className="py-6 px-3 text-center flex flex-col items-center gap-1.5">
                  <span className="text-xs text-[var(--text-subtle)]">{emptyText}</span>
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        searchInputRef.current?.focus();
                      }}
                      className="text-[11px] font-medium text-[var(--text-primary)] underline underline-offset-2 cursor-pointer"
                    >
                      Clear search
                    </button>
                  )}
                </div>
              ) : (
                filteredOptions.map((opt) => {
                  const isSelected = selectedSet.has(String(opt.value));
                  return (
                    <label
                      key={String(opt.value)}
                      role="option"
                      aria-selected={isSelected}
                      className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs cursor-pointer select-none transition-colors ${
                        isSelected
                          ? 'bg-[var(--text-primary)]/10 text-[var(--text-primary)] font-medium'
                          : 'text-[var(--text-subtle)] hover:bg-[var(--text-primary)]/5 hover:text-[var(--text-primary)]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleValue(opt.value)}
                        className="rounded border-[var(--line-subtle)] accent-[var(--text-primary)] cursor-pointer shrink-0"
                      />
                      <span className="truncate flex-1">{opt.label}</span>
                      {opt.meta && (
                        <span className="text-[10px] opacity-65 font-sans tabular-nums shrink-0">
                          {opt.meta}
                        </span>
                      )}
                    </label>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="px-2.5 py-1.5 border-t border-[var(--line-subtle)] bg-[var(--bg-surface)] shrink-0 flex items-center justify-between text-[11px]">
              <span className="text-[var(--text-subtle)]">
                {values.length} of {options.length} selected
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  triggerRef.current?.focus();
                }}
                className="px-2.5 py-1 rounded bg-[var(--text-primary)] text-[var(--bg-app)] font-medium hover:opacity-90 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <div className={`flex flex-col gap-1 w-full ${className}`}>
      {label && (
        <label className="text-xs font-semibold text-[var(--text-primary)] select-none">
          {label}
        </label>
      )}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel || label || placeholder}
        title={title || triggerSummary}
        onClick={() => setIsOpen((prev) => !prev)}
        className={`w-full h-9 inline-flex items-center gap-2 px-3 py-1.5 rounded border transition-colors cursor-pointer text-xs font-medium select-none ${
          values.length > 0 || isOpen
            ? 'border-[var(--text-primary)] text-[var(--text-primary)] bg-[var(--text-primary)]/5'
            : 'border-[var(--line-subtle)] hover:border-[var(--text-primary)]/40 text-[var(--text-subtle)] hover:text-[var(--text-primary)] bg-[var(--bg-surface)]'
        } ${disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : ''}`}
      >
        <span
          className={`truncate flex-1 text-left font-sans ${
            selectedOptions.length === 0 ? 'opacity-75 font-normal' : ''
          }`}
        >
          {triggerSummary}
        </span>
        <span
          className={`font-sans text-xs opacity-60 shrink-0 select-none transition-transform duration-150 ${
            isOpen ? 'rotate-180' : ''
          }`}
        >
          ▾
        </span>
      </button>
      {menuNode}
    </div>
  );
}

export default MultiSelectDropdown;
