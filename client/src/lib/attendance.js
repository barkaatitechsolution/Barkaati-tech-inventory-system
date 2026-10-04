// Attendance row shape shared by the marking screen.
//
// Kept out of Employee.jsx so the merge can be exercised directly: the bug this
// replaced was invisible to every render test because it lived in the wiring
// between the picker and this state.

// The blank shape of one employee's attendance for one day.
export const emptyAttRow = () => ({
  status: "present",
  time_in: "",
  time_out: "",
  notes: ""
});

// Merge one changed field into an employee's row, keeping whatever else was
// already entered.
//
// The field name and the new value are separate arguments on purpose. This
// previously took a pre-built patch object while every caller passed
// (field, value), so the value was thrown away and the field name was spread
// into the row as numbered keys -- the status dropdown and the clock times
// silently did nothing at all.
export function patchAttRow(previous, field, value) {
  return { ...emptyAttRow(), ...previous, [field]: value };
}