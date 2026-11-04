"use client";

import { CheckCircle2, RotateCcw, XCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { QuizQuestion } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Callers pass a `key` tied to the artifact version so a new quiz starts fresh. */
export function QuizPlayer({ questions }: { questions: QuizQuestion[] }) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<(number | null)[]>(() => questions.map(() => null));
  const [finished, setFinished] = useState(false);

  const score = answers.filter((a, i) => a === questions[i]?.answerIndex).length;

  if (finished) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <div className="mx-auto max-w-xl">
        <div className="rounded-2xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Your score</p>
          <p className="mt-1 font-display text-6xl tracking-tight">
            {score}/{questions.length}
          </p>
          <p className="mt-2 text-sm">{pct >= 80 ? "Excellent work!" : pct >= 50 ? "Good effort — review the explanations below." : "Keep studying — the explanations will help."}</p>
          <Button
            className="mt-5"
            onClick={() => {
              setAnswers(questions.map(() => null));
              setIndex(0);
              setFinished(false);
            }}
          >
            <RotateCcw /> Retake quiz
          </Button>
        </div>
        <ol className="mt-6 space-y-4">
          {questions.map((q, i) => {
            const correct = answers[i] === q.answerIndex;
            return (
              <li key={i} className="rounded-xl border p-4 text-sm">
                <p className="flex gap-2 font-medium">
                  {correct ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" />}
                  {q.question}
                </p>
                <p className="mt-2 pl-6 text-muted-foreground">
                  Correct answer: <span className="text-foreground">{q.options[q.answerIndex]}</span>
                </p>
                <p className="mt-1 pl-6 text-muted-foreground">{q.explanation}</p>
              </li>
            );
          })}
        </ol>
      </div>
    );
  }

  const q = questions[index];
  const chosen = answers[index];
  const answered = chosen !== null;

  return (
    <div className="mx-auto max-w-xl">
      <div className="mb-4 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="shrink-0">
          Question {index + 1} of {questions.length}
        </span>
        <Progress value={((index + (answered ? 1 : 0)) / questions.length) * 100} className="h-1.5" />
      </div>
      <p className="text-lg font-medium text-pretty">{q.question}</p>
      <div className="mt-4 space-y-2" role="radiogroup" aria-label="Answer options">
        {q.options.map((option, i) => {
          const isCorrect = i === q.answerIndex;
          const isChosen = i === chosen;
          return (
            <button
              key={i}
              role="radio"
              aria-checked={isChosen}
              disabled={answered}
              onClick={() => setAnswers((a) => a.map((x, j) => (j === index ? i : x)))}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
                !answered && "hover:border-brand/50 hover:bg-brand-soft/30",
                answered && isCorrect && "border-success/60 bg-success/10",
                answered && isChosen && !isCorrect && "border-destructive/60 bg-destructive/10",
              )}
            >
              <span className="grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium">{String.fromCharCode(65 + i)}</span>
              <span className="pt-0.5">{option}</span>
            </button>
          );
        })}
      </div>
      {answered && (
        <div className={cn("mt-4 rounded-xl p-4 text-sm", chosen === q.answerIndex ? "bg-success/10" : "bg-destructive/10")}>
          <p className="font-medium">{chosen === q.answerIndex ? "Correct!" : `Not quite — the answer is ${String.fromCharCode(65 + q.answerIndex)}.`}</p>
          <p className="mt-1 text-foreground/80">{q.explanation}</p>
        </div>
      )}
      <div className="mt-5 flex justify-between">
        <Button variant="ghost" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
          Back
        </Button>
        {index < questions.length - 1 ? (
          <Button disabled={!answered} onClick={() => setIndex((i) => i + 1)}>
            Next question
          </Button>
        ) : (
          <Button disabled={!answered} onClick={() => setFinished(true)}>
            See results
          </Button>
        )}
      </div>
    </div>
  );
}
