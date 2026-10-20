import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import Image from "next/image";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";

export default function CustomerLoginPage() {
  return (
    <div className="flex flex-col">
      <HeroBlock
        size="tall"
        title={
          // Logo above the title (decorative: the h1 text names the brand).
          <span className="flex flex-col items-start gap-4">
            <Image
              src="/brand/dulcecalle-logo.png"
              alt=""
              width={72}
              height={72}
              className="h-[72px] w-[72px] rounded-[var(--r-lg)] bg-surface object-contain"
              data-testid="login-logo"
              priority
            />
            <span>Dulce Calle</span>
          </span>
        }
        subtitle="Consulta tu saldo y tus movimientos."
      />
      <Sheet>
        <CustomerLoginForm showBack />
      </Sheet>
    </div>
  );
}
