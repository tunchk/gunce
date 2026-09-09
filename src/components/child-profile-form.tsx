"use client";

import { useActionState } from "react";
import { saveChildProfileAction, type ActionState } from "@/app/actions";
import { AGE_GROUP_LABELS, DEFAULT_TIMEZONES } from "@/lib/constants";
import { Button, SelectField, TextField } from "@/components/ui";

const initial: ActionState = {};

export function ChildProfileForm({
  defaults,
}: {
  defaults: {
    displayName: string;
    ageGroup: string;
    timeZone: string;
  };
}) {
  const [state, action, pending] = useActionState(saveChildProfileAction, initial);

  return (
    <form action={action} className="space-y-4">
      <TextField
        label="Çocuğun görünen adı"
        name="displayName"
        defaultValue={defaults.displayName}
        required
        error={state.errors?.displayName}
      />
      <SelectField
        label="Yaş grubu"
        name="ageGroup"
        defaultValue={defaults.ageGroup}
        error={state.errors?.ageGroup}
      >
        {Object.entries(AGE_GROUP_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </SelectField>
      <SelectField
        label="Saat dilimi"
        name="timeZone"
        defaultValue={defaults.timeZone}
        error={state.errors?.timeZone}
      >
        {DEFAULT_TIMEZONES.map((tz) => (
          <option key={tz} value={tz}>
            {tz}
          </option>
        ))}
      </SelectField>
      {state.message ? (
        <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">
          {state.message}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Devam et"}
      </Button>
    </form>
  );
}
