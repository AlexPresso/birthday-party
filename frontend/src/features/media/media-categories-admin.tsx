"use client";
import { useState } from "react";
import { Folder, Eye, EyeOff, Plus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { mediaCategorySchema, type MediaCategory } from "./contracts";
import { useI18n } from "@/lib/i18n-context";
import { ErrorNotice } from "@/components/ui";
import { useConfirm } from "@/components/confirm-dialog";
import "./media-categories.css";

export function MediaCategoriesAdmin({
  categories,
  onSaved,
}: {
  categories: MediaCategory[];
  onSaved: (category: MediaCategory) => void;
}) {
  const { t } = useI18n();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [isPublic, setPublic] = useState(false);
  const [busy, setBusy] = useState<number | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (busy !== null) return;
    setBusy("create");
    setError(null);
    setNotice("");
    try {
      const category = await api(
        "/admin/media-categories",
        mediaCategorySchema,
        { method: "POST", body: { name: name.trim(), isPublic } },
      );
      onSaved(category);
      setName("");
      setPublic(false);
      setNotice(t("categories.created"));
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(category: MediaCategory) {
    if (busy !== null) return;
    if (
      !category.isPublic &&
      !(await confirm({
        message: t("categories.publishConfirm", { name: category.name }),
      }))
    )
      return;
    setBusy(category.id);
    setError(null);
    setNotice("");
    try {
      const saved = await api(
        `/admin/media-categories/${category.id}`,
        mediaCategorySchema,
        {
          method: "PUT",
          body: { name: category.name, isPublic: !category.isPublic },
        },
      );
      onSaved(saved);
      setNotice(t("categories.updated"));
    } catch (cause) {
      setError(errorMessage(cause, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section
      id="media-categories"
      className="media-categories-admin panel"
      aria-labelledby="media-categories-heading"
    >
      <div className="section-row">
        <h2 id="media-categories-heading">
          <Folder size={21} aria-hidden="true" />
          {t("categories.title")}
        </h2>
      </div>
      <p className="muted">{t("categories.description")}</p>
      <form onSubmit={create}>
        <label htmlFor="new-media-category">{t("categories.name")}</label>
        <div className="media-category-create-row">
          <input
            id="new-media-category"
            value={name}
            required
            maxLength={80}
            disabled={busy !== null || categories.length >= 100}
            onChange={(event) => setName(event.target.value)}
          />
          <button
            type="submit"
            className="button secondary"
            disabled={busy !== null || categories.length >= 100 || !name.trim()}
          >
            <Plus size={18} aria-hidden="true" />
            {t(busy === "create" ? "categories.creating" : "categories.create")}
          </button>
        </div>
        <label className="media-category-visibility">
          <input
            type="checkbox"
            checked={isPublic}
            disabled={busy !== null || categories.length >= 100}
            onChange={(event) => setPublic(event.target.checked)}
          />
          {t("categories.visible")}
        </label>
      </form>
      {categories.length ? (
        <ul className="media-category-list">
          {categories.map((category) => (
            <li key={category.id}>
              <div>
                <strong>{category.name}</strong>
                <span className="fine-print">
                  {category.isPublic ? (
                    <Eye size={14} aria-hidden="true" />
                  ) : (
                    <EyeOff size={14} aria-hidden="true" />
                  )}
                  {t(
                    category.isPublic
                      ? "categories.public"
                      : "categories.private",
                  )}
                </span>
              </div>
              <button
                type="button"
                className="button secondary"
                disabled={busy !== null}
                onClick={() => void toggle(category)}
              >
                {t(
                  category.isPublic ? "categories.hide" : "categories.publish",
                  { name: category.name },
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fine-print">{t("categories.empty")}</p>
      )}
      <p className="fine-print" role="status">
        {notice}
      </p>
      <ErrorNotice message={error} />
    </section>
  );
}
