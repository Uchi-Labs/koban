import { describe, expect, it } from "vitest";
import { addMonths, daysInCalendarMonth, mondayIndexOfFirst, occurrencesInMonth } from "@/lib/recurring-calendar";

describe("occurrencesInMonth", () => {
  it("places a monthly item on its anchor day every month, forward and backward", () => {
    const item = { cadence: "monthly" as const, nextDate: "2026-07-13" };
    expect(occurrencesInMonth(item, "2026-07")).toEqual(["2026-07-13"]);
    expect(occurrencesInMonth(item, "2026-09")).toEqual(["2026-09-13"]);
    expect(occurrencesInMonth(item, "2026-05")).toEqual(["2026-05-13"]);
  });

  it("clamps day-of-month for short months (Jan 31 → Feb 28)", () => {
    const item = { cadence: "monthly" as const, nextDate: "2026-01-31" };
    expect(occurrencesInMonth(item, "2026-02")).toEqual(["2026-02-28"]);
    expect(occurrencesInMonth(item, "2026-04")).toEqual(["2026-04-30"]);
  });

  it("skips off-cycle months for quarterly and annual cadences", () => {
    const quarterly = { cadence: "quarterly" as const, nextDate: "2026-07-05" };
    expect(occurrencesInMonth(quarterly, "2026-08")).toEqual([]);
    expect(occurrencesInMonth(quarterly, "2026-10")).toEqual(["2026-10-05"]);
    expect(occurrencesInMonth(quarterly, "2026-04")).toEqual(["2026-04-05"]);

    const annual = { cadence: "annual" as const, nextDate: "2026-03-01" };
    expect(occurrencesInMonth(annual, "2026-07")).toEqual([]);
    expect(occurrencesInMonth(annual, "2027-03")).toEqual(["2027-03-01"]);
  });

  it("steps weekly and biweekly items across the whole month from the anchor", () => {
    const weekly = { cadence: "weekly" as const, nextDate: "2026-07-03" };
    expect(occurrencesInMonth(weekly, "2026-07")).toEqual([
      "2026-07-03",
      "2026-07-10",
      "2026-07-17",
      "2026-07-24",
      "2026-07-31"
    ]);

    const biweekly = { cadence: "biweekly" as const, nextDate: "2026-07-20" };
    expect(occurrencesInMonth(biweekly, "2026-08")).toEqual(["2026-08-03", "2026-08-17", "2026-08-31"]);
    // backward projection into the month before the anchor
    expect(occurrencesInMonth(biweekly, "2026-06")).toEqual(["2026-06-08", "2026-06-22"]);
  });
});

describe("calendar grid helpers", () => {
  it("computes Monday-first offsets and month lengths", () => {
    // 2026-07-01 is a Wednesday → index 2 in a Monday-first week
    expect(mondayIndexOfFirst("2026-07")).toBe(2);
    expect(daysInCalendarMonth("2026-07")).toBe(31);
    expect(daysInCalendarMonth("2028-02")).toBe(29);
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
  });
});
