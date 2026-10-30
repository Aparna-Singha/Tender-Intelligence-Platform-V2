"use client";
import { MotionConfig } from "framer-motion";
import type { ReactNode, JSX } from "react";
export function DesignMotionProvider({
  children,
}: {
  readonly children: ReactNode;
}): JSX.Element {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
