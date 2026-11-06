"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEventHandler,
  type ReactNode,
} from "react";
import { createAutosaveQueue } from "./autosave-queue";

type Save = () => Promise<boolean>;
type Registry = {
  register: (scope: string, save: Save) => () => void;
  flush: (scope: string) => Promise<boolean>;
};
const RegistryContext = createContext<Registry | null>(null);
const ScopeContext = createContext<string | null>(null);

export function AutosaveProvider({ children }: { children: ReactNode }) {
  const [registry] = useState<Registry>(() => {
    const scopes = new Map<string, Set<Save>>();
    return {
      register(scope, save) {
        const saves = scopes.get(scope) ?? new Set<Save>();
        saves.add(save);
        scopes.set(scope, saves);
        return () => {
          saves.delete(save);
          if (!saves.size) scopes.delete(scope);
        };
      },
      async flush(scope) {
        const saves = scopes.get(scope);
        if (!saves) return true;
        const results = await Promise.all([...saves].map((save) => save()));
        return results.every(Boolean);
      },
    };
  });
  return <RegistryContext value={registry}>{children}</RegistryContext>;
}

export function AutosaveScope({
  name,
  active,
  children,
}: {
  name: string;
  active: boolean;
  children: ReactNode;
}) {
  const registry = useContext(RegistryContext);
  const previous = useRef(active);
  useEffect(() => {
    if (previous.current && !active) void registry?.flush(name);
    previous.current = active;
  }, [active, name, registry]);
  return <ScopeContext value={name}>{children}</ScopeContext>;
}

export function useAutosaveNavigation() {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error("Autosave navigation requires its provider.");
  return registry.flush;
}

/** Serializes blur and navigation saves without replacing the editor's draft. */
export function useAutosave({ save }: { save: Save }) {
  const registry = useContext(RegistryContext);
  const scope = useContext(ScopeContext);
  const latest = useRef(save);
  const [saving, setSaving] = useState(false);
  useLayoutEffect(() => {
    latest.current = save;
  }, [save]);

  const queue = useRef<Save | null>(null);
  const flush = useCallback(() => {
    queue.current ??= createAutosaveQueue(async () => {
      setSaving(true);
      try {
        return await latest.current();
      } finally {
        setSaving(false);
      }
    });
    return queue.current();
  }, []);
  useEffect(() => {
    if (registry && scope) return registry.register(scope, flush);
  }, [registry, scope, flush]);

  const onBlur: FocusEventHandler<HTMLElement> = useCallback(
    (event) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.matches(
          "input:not([readonly]), textarea, select, [contenteditable=true]",
        )
      )
        void flush();
    },
    [flush],
  );
  return { flush, saving, onBlur };
}
