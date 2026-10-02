-- AlterTable
ALTER TABLE "PrescriptionItem" ADD COLUMN     "preparedAt" TIMESTAMP(3),
ADD COLUMN     "preparedById" TEXT,
ADD COLUMN     "preparedInvoiceLineId" TEXT,
ADD COLUMN     "preparedQty" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preparedUnitPrice" DECIMAL(12,2);

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "requirePaymentBeforeDispense" BOOLEAN NOT NULL DEFAULT false;
