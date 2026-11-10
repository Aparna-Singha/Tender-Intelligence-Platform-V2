import { notFound } from "next/navigation";
import { VisualPreview } from "../../../components/visual-preview";

export default async function VisualPreviewPage({
  params,
}: {
  readonly params: Promise<{ view: string }>;
}): Promise<React.JSX.Element> {
  const { view } = await params;
  if (
    process.env.VERCEL_ENV !== "preview" ||
    process.env.BIDVEDA_VISUAL_PREVIEW !== "true" ||
    (view !== "dashboard" && view !== "evidence")
  )
    notFound();
  return <VisualPreview view={view} />;
}
