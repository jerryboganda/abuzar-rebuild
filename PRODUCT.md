# Trader rebuild

<!-- impeccable:product-schema 1 -->

## Platform

web

The interface runs in the Windows Tauri 2 WebView. The frontend is TypeScript
and DOM, the data server is Rust (axum/sqlx), and the database is PostgreSQL.
This is a desktop application, not a mobile-web product.

## Users

Cashiers, stock and purchase staff, accountants, and managers use the same
application. Each audience must be represented in the first Modern-mode pilot.
Keyboard, mouse, and barcode-scanner entry are primary interactions.

## Product Purpose

Preserve the implemented ERP/POS capabilities of the rebuilt application while
making tasks easier to find, read, and complete. Classic and Modern are two
presentations of the same business engine, not separate implementations of
financial rules or database transactions.

## Operating Context

Windows desktops and laptops, including a 1366x768 display and enlarged Windows
display settings. Multiple tasks can remain open. Existing field meanings,
shortcuts, required data, validation, and explicit save/post/cancel behavior must
remain intact. Screen mode changes apply at the next sign-in.

## Capabilities and Constraints

- One installed application with per-user Classic and Modern modes.
- Modern is the default when no preference exists. Classic remains available.
- Preferences are local to the workstation and isolated by app user and
  database. They contain presentation settings, not credentials or business data.
- Modern covers every currently implemented module, with searchable module
  navigation and workspace tabs.
- English only, using existing business terminology.
- Modern supports system/light/dark appearance, Compact and Comfortable density,
  and adjustable text size.
- Classic and Modern print layouts are selectable independently of screen mode.
  All existing document formats are in scope; required values, fiscal fields,
  barcode payloads, and machine-consumed exports must remain correct.
- Retain the TypeScript frontend/runtime, Rust backend, and PostgreSQL. Do not
  introduce a frontend framework or change business rules as a design shortcut.
- Actual printer models and paper/label dimensions need an inventory. Missing
  recovered document definitions and unsupported hardware remain explicit
  blockers, not fabricated capabilities.

## Brand Commitments

Preserve existing product names, approved assets, and factual copy. The user
requested a Windows-familiar professional interface with prototypes shown before
broad implementation, not a rebrand.

## Evidence on Hand

`data/src` contains the rebuild's redacted definitions, menus, and scripts.
`docs/PARITY.md`, `docs/FIDELITY.md`, and the detailed parity-run notes record
measured behavior and known gaps. Their historical counts are not interchangeable
with complete screen or document acceptance.

Use synthetic prototype and CI data. Neither customer data nor operational
credentials belong in this public repository.

## Product Principles

- Keep business meaning and explicit user intent authoritative.
- Make task state and errors visible; never imply an uncertain write succeeded.
- Preserve Classic while measuring Modern coverage explicitly.
- Favor keyboard efficiency and readable data over decorative effects.
- Count a feature complete only when its applicable states and outcomes work.

## Accessibility & Inclusion

Modern targets WCAG 2.2 AA, including keyboard-only use, screen-reader support,
contrast, visible focus, and text resizing. Classic is assessed separately.
Support 125-200% Windows scaling, reduced motion, and high-contrast settings.
