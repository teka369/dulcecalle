import Image from "next/image";
import { CustomerLoginForm } from "@/components/customer/CustomerLoginForm";

export default function CustomerLoginPage() {
  return (
    <div className="flex flex-col gap-4">
      <Image
        src="/DulceCalle.png"
        alt="Dulce Calle"
        width={72}
        height={72}
        className="h-[72px] w-[72px] rounded-2xl object-cover"
        priority
      />
      <CustomerLoginForm showBack />
    </div>
  );
}
