"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { AppShell } from "@/components/layout/app-shell";
import { apiFetch } from "@/lib/api";

type Employee = {
  id: string;
  email: string;
  full_name: string;
  department: string | null;
  is_active: boolean;
};

export default function EmployeesPage() {
  const qc = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [department, setDepartment] = useState("");

  const list = useQuery({
    queryKey: ["employees"],
    queryFn: () => apiFetch<Employee[]>("/employees"),
  });

  const create = useMutation({
    mutationFn: () =>
      apiFetch<Employee>("/employees", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          email,
          department: department || null,
        }),
      }),
    onSuccess: () => {
      setFullName("");
      setEmail("");
      setDepartment("");
      qc.invalidateQueries({ queryKey: ["employees"] });
      qc.invalidateQueries({ queryKey: ["overview"] });
    },
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    create.mutate();
  }

  return (
    <AppShell title="Employees">
      <form
        onSubmit={onSubmit}
        className="mb-6 grid gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-4"
      >
        <input
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Full name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          required
        />
        <input
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Department"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-accent-fg"
          disabled={create.isPending}
        >
          Add employee
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-border bg-surface">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Department</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((emp) => (
              <tr key={emp.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3">{emp.full_name}</td>
                <td className="px-4 py-3">{emp.email}</td>
                <td className="px-4 py-3">{emp.department ?? "—"}</td>
                <td className="px-4 py-3">
                  {emp.is_active ? "Active" : "Inactive"}
                </td>
              </tr>
            ))}
            {!list.isLoading && (list.data?.length ?? 0) === 0 && (
              <tr>
                <td className="px-4 py-6 text-muted" colSpan={4}>
                  No employees yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
