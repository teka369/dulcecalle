import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";
import Image from "next/image";
import { HeroBlock } from "@/components/ui/HeroBlock";
import { Sheet } from "@/components/ui/Sheet";

export default function CustomerLoginPage() {
  return (
    <div className="flex flex-col">
      <HeroBlock size="tall" title="Dulce Calle" subtitle="Consulta tu saldo y tus movimientos.">
        <div className="mt-4">
          <Image
            src="/brand/dulcecalle-logo.png"
            alt="Dulce Calle"
            width={72}
            height={72}
            className="h-[72px] w-[72px] rounded-[var(--r-lg)] bg-surface object-contain"
            priority
          />
        </div>
      </HeroBlock>
      <Sheet>
        <CustomerLoginForm showBack />
      </Sheet>
    </div>
  );
}
