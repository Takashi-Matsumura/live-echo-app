import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth/admin";
import { LoginForm } from "@/app/admin/login/login-form";

export default async function AdminLoginPage() {
  if (await isAdmin()) redirect("/admin");

  return (
    <div className="flex min-h-full flex-1 items-center justify-center px-6">
      <LoginForm />
    </div>
  );
}
