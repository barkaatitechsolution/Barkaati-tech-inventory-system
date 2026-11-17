// Attendance row shape shared by the marking screen and payroll reports.

export const emptyAttRow = () => ({
  status: "present",
  time_in: "",
  time_out: "",
  notes: ""
});

export function patchAttRow(previous, field, value) {
  return { ...emptyAttRow(), ...previous, [field]: value };
}
