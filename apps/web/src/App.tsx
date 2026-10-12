import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { DashboardPage } from '@/pages/DashboardPage';
import { FocusPage } from '@/pages/FocusPage';
import { PlanPage } from '@/pages/PlanPage';
import { TasksPage } from '@/pages/TasksPage';

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/plan" element={<PlanPage />} />
        <Route path="/focus" element={<FocusPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
