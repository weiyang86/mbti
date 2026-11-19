import { createElement, type ReactNode } from "react";

export interface PageHeadingProps {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

/** A presentation-only page heading shared by the Web admin and client surfaces. */
export function PageHeading({ eyebrow, title, description, actions, className }: PageHeadingProps) {
  const classes = ["admin-page-heading", actions == null ? "" : "admin-heading-actions", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return createElement(
    "div",
    { className: classes },
    createElement(
      "div",
      null,
      createElement("p", { className: "eyebrow" }, eyebrow),
      createElement("h1", null, title),
      description == null ? null : createElement("p", null, description)
    ),
    actions ?? null
  );
}
