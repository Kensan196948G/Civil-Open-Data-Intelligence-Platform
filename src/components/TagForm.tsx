"use client";

import { useActionState } from "react";
import { createTagAction, type TagActionState } from "@/app/tags/actions";

const initialState: TagActionState = {};

export function TagForm() {
  const [state, formAction, pending] = useActionState(createTagAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <div>
        <label htmlFor="tag-name" className="mb-1 block text-xs font-medium text-slate-600">
          🏷️ タグ名
        </label>
        <input
          id="tag-name"
          name="name"
          required
          className="rounded border border-slate-300 px-2 py-1.5 text-sm"
        />
      </div>
      <div>
        <label htmlFor="tag-color" className="mb-1 block text-xs font-medium text-slate-600">
          色
        </label>
        <input
          id="tag-color"
          name="color"
          type="color"
          defaultValue="#2563eb"
          className="h-9 w-14 rounded border border-slate-300"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {pending ? "⏳" : "➕ 追加"}
      </button>
      {state.error && <p className="text-sm text-red-600">⚠️ {state.error}</p>}
    </form>
  );
}
