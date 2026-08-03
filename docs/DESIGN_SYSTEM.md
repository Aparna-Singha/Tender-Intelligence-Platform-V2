# Design System

## Principles

The interface is calm, evidence-led and independent. It uses a light grey-blue
background, white surfaces, restrained blue actions, compact status badges and an
8 px spacing rhythm. It does not imitate a government portal.

One primary action should be obvious on each page. Secondary technical detail is
placed in drawers, modals, tabs or version views. Status is expressed in text as
well as colour.

## Shared primitives

`@tender/ui` owns Button, IconButton, Input, Textarea, Select, Checkbox, Field,
FormMessage, Card, StatCard, Badge, Alert, Progress, Spinner, Skeleton, EmptyState,
Tabs, Breadcrumbs, Modal, Drawer, Table, Pagination, PageHeader, SectionHeader and
Tooltip. It also owns explicit human-readable enum presentation.

Modal and Drawer trap focus, close with Escape, restore prior focus and use dialog
semantics. Controls expose visible focus, disabled, loading and validation states.
Motion is reduced when the operating system requests it.

## Responsive behaviour

- Desktop uses a 240 px sidebar, 64 px top bar and content up to 1400 px.
- Below 900 px, the sidebar becomes an accessible drawer.
- Tables scroll within a focusable region.
- Below 600 px, headers, actions, filters and multi-column forms stack.
- Validation widths are 1440, 1024, 768 and 390 px.

## Language

Backend enum values never change. Presentation converts values such as
`PRIVATE_LIMITED` to “Private limited company” and `HUMAN_REVIEW_REQUIRED` to
“Human review required”. “Ready” means processed; it never means verified,
eligible, compliant or approved.
