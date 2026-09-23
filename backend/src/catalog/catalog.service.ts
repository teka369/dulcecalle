import { Injectable } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AppError, ERROR_CODES, MESSAGES } from "../shared/errors";
import type {
  CreateCustomerDto,
  CreateInitialDebtDto,
  CreatePreparationDto,
  CreateProductDto,
  CreateSupplierDto,
  PatchCustomerDto,
  PatchProductDto,
  PatchSupplierDto,
  ShrinkDto,
  SurtirDto,
} from "./catalog.dto";
import {
  nextAvgCostAfterSurtir,
  openingStoredAvgCost,
  reconcileSurtirCost,
  weightedAvgCost,
} from "../shared/inventory";
import { asCop, copToJson, mulCop } from "../shared/money";
import { occurredOnDate, dateKey } from "../shared/clock";
import { assertDayEditable, lockAndAssertDayEditable } from "../shared/day-guard";
import type { BusinessContext } from "../identity/auth.types";
import { nextCodeFromExisting } from "../shared/customer-code";
import { imageJson } from "./media.service";
