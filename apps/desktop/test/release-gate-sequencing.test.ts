import { describe, expect, test } from "vitest";

import { runStrictPackagedQualificationChecks } from "../../../scripts/release-gate-sequencing.mjs";

describe("strict release gate sequencing", () => {
  test("continues package qualification and E2E even when independent release evidence is Blocked", async () => {
    const calls: string[] = [];
    const metadataFailures = ["Stage 5 overall status is Blocked."];

    await runStrictPackagedQualificationChecks({
      verifyLayout: async () => {
        calls.push("layout");
        return "C:/qualified-package";
      },
      verifyOwnerQualification: async (packageDirectory: string) => {
        calls.push(`owner:${packageDirectory}`);
        return true;
      },
      runPackagedE2e: async (packageDirectory: string) => {
        calls.push(`e2e:${packageDirectory}`);
      }
    });

    expect(metadataFailures).toEqual(["Stage 5 overall status is Blocked."]);
    expect(calls).toEqual(["layout", "owner:C:/qualified-package", "e2e:C:/qualified-package"]);
  });

  test("does not run E2E after a layout or owner qualification failure", async () => {
    const layoutFailureCalls: string[] = [];
    await runStrictPackagedQualificationChecks({
      verifyLayout: async () => {
        layoutFailureCalls.push("layout");
        return undefined;
      },
      verifyOwnerQualification: async () => {
        layoutFailureCalls.push("owner");
        return true;
      },
      runPackagedE2e: async () => {
        layoutFailureCalls.push("e2e");
      }
    });
    expect(layoutFailureCalls).toEqual(["layout"]);

    const ownerFailureCalls: string[] = [];
    await runStrictPackagedQualificationChecks({
      verifyLayout: async () => {
        ownerFailureCalls.push("layout");
        return "C:/qualified-package";
      },
      verifyOwnerQualification: async () => {
        ownerFailureCalls.push("owner");
        return false;
      },
      runPackagedE2e: async () => {
        ownerFailureCalls.push("e2e");
      }
    });
    expect(ownerFailureCalls).toEqual(["layout", "owner"]);
  });
});
