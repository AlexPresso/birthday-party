"use client";
import { useState } from "react";
import type { AdminWelcome } from "../welcome/contracts";
import type { MediaCategory } from "../media/contracts";
import { WelcomeAdmin } from "../welcome/welcome-admin";
import { MediaCategoriesAdmin } from "../media/media-categories-admin";

export function WelcomeSettings({
  initial,
  initialCategories,
}: {
  initial: AdminWelcome;
  initialCategories: MediaCategory[];
}) {
  const [categories, setCategories] = useState(initialCategories);
  return (
    <>
      <WelcomeAdmin initial={initial} categories={categories} />
      <MediaCategoriesAdmin
        categories={categories}
        onSaved={(category) =>
          setCategories((current) => {
            const exists = current.some((item) => item.id === category.id);
            return exists
              ? current.map((item) =>
                  item.id === category.id ? category : item,
                )
              : [...current, category];
          })
        }
      />
    </>
  );
}
