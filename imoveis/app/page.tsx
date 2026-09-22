import { chatGPTSignInPath, getChatGPTUser } from "@/app/chatgpt-auth";
import { AppAccessError, requireAppProfile } from "@/lib/app-auth";

export const dynamic = "force-dynamic";

function AccessScreen({
  title,
  message,
  action,
}: {
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <main className="access-screen">
      <section className="access-panel">
        <div className="access-brand">
          <span>GC</span>
          <strong>gestãocasa</strong>
        </div>
        <p className="access-kicker">PATRIMÔNIO &amp; FAMÍLIA</p>
        <h1>{title}</h1>
        <p>{message}</p>
        {action}
      </section>
    </main>
  );
}

export default async function Home() {
  const identity = await getChatGPTUser();
  if (!identity) {
    return (
      <AccessScreen
        title="Seu patrimônio, em um só lugar"
        message="Entre com sua conta para consultar imóveis, documentos e movimentações da família."
        action={
          <a className="access-button" href={chatGPTSignInPath("/")} target="_top">
            Entrar com ChatGPT
          </a>
        }
      />
    );
  }

  try {
    await requireAppProfile();
  } catch (error) {
    const message =
      error instanceof AppAccessError
        ? error.message
        : "Não foi possível validar seu acesso.";
    return <AccessScreen title="Acesso ainda não liberado" message={message} />;
  }

  return (
    <main className="app-frame-shell">
      <iframe title="Gestão Casa" src="/gestao/index.html" className="app-frame" />
    </main>
  );
}
