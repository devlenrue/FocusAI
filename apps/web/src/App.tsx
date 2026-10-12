import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { api } from "@/lib/api";
import { AuthPage } from "@/pages/AuthPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { FocusPage } from "@/pages/FocusPage";
import { PlanPage } from "@/pages/PlanPage";
import { SchedulePage } from "@/pages/SchedulePage";
import { TasksPage } from "@/pages/TasksPage";

export function App() {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery({
    queryKey: ["auth", "session"],
    queryFn: async () => {
      try {
        return await api.getSession();
      } catch (error) {
        if (error instanceof Error && "status" in error && error.status === 401)
          return null;
        throw error;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
  useEffect(() => {
    const markSessionExpired = () =>
      queryClient.setQueryData(["auth", "session"], null);
    window.addEventListener("focusai:session-expired", markSessionExpired);
    return () =>
      window.removeEventListener("focusai:session-expired", markSessionExpired);
  }, [queryClient]);

  const logout = useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["dashboard"] });
      queryClient.removeQueries({ queryKey: ["tasks"] });
      queryClient.removeQueries({ queryKey: ["plan"] });
      queryClient.removeQueries({ queryKey: ["focus"] });
      queryClient.setQueryData(["auth", "session"], null);
    },
  });

  if (sessionQuery.isPending) {
    return (
      <main className="auth-loading" aria-live="polite">
        <span className="auth-loading-orb">
          <LoaderCircle className="spin" size={22} />
        </span>
        <p>Opening your private workspace…</p>
      </main>
    );
  }

  if (sessionQuery.isError) {
    return (
      <main className="auth-loading auth-unavailable" role="alert">
        <span className="auth-loading-orb">
          <AlertTriangle size={22} />
        </span>
        <h1>FocusAI is temporarily unavailable.</h1>
        <p>{sessionQuery.error.message}</p>
        <button
          className="button button-primary"
          type="button"
          onClick={() => sessionQuery.refetch()}
        >
          Try again
        </button>
      </main>
    );
  }

  if (!sessionQuery.data) return <AuthPage />;

  return (
    <AppShell
      user={sessionQuery.data.user}
      onSignOut={() => logout.mutate()}
      isSigningOut={logout.isPending}
    >
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
