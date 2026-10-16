import { isValidElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import TenderWorkspacePage from "./page";

describe("tender workspace route", () => {
  it("renders every tender ID directly and lets the workspace resolve its stage", async () => {
    const page = await TenderWorkspacePage({
      params: Promise.resolve({
        organisationId: "org-1",
        tenderId: "tender-1",
      }),
    });

    expect(isValidElement(page)).toBe(true);
    const workspace = (
      page as ReactElement<{
        children: ReactElement<{
          organisationId: string;
          tenderId: string;
        }>;
      }>
    ).props.children;
    expect(workspace.props).toMatchObject({
      organisationId: "org-1",
      tenderId: "tender-1",
    });
  });
});
