"use client";

import { useState } from "react";

import { ko } from "@/i18n/ko";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface Props {
  label: string;
  pending: boolean;
  disabled?: boolean;
  buttonClassName?: string;
  onConfirm: () => Promise<void>;
}

export function StepExecuteButton({ label, pending, disabled, buttonClassName, onConfirm }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className={cn("w-full", buttonClassName)} disabled={disabled || pending}>
          {pending ? ko.common.loading : label}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{ko.dialog.newVersionTitle}</DialogTitle>
          <DialogDescription>{ko.dialog.newVersionDescription}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            {ko.common.cancel}
          </Button>
          <Button
            onClick={async () => {
              await onConfirm();
              setOpen(false);
            }}
          >
            {ko.dialog.confirmExecute}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
