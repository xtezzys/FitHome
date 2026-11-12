import type { ReactNode } from 'react';
import type { Program } from '../types/program';
import { PLACE_LABELS, label } from '../lib/labels';
import './ProgramCard.css';

/**
 * Карточка программы (docs/design.md §3.2): название, место, описание,
 * количество упражнений и слот действий (копировать/открыть/удалить).
 */

interface ProgramCardProps {
  program: Program;
  children?: ReactNode;
}

export function ProgramCard({ program, children }: ProgramCardProps) {
  return (
    <div className="program-card">
      <div className="program-card__top">
        <h3 className="program-card__name">{program.name}</h3>
        <span className="program-card__place">{label(PLACE_LABELS, program.place)}</span>
      </div>
      {program.description && <p className="program-card__description">{program.description}</p>}
      <p className="program-card__count">
        {program.exercisesCount ?? program.exercises?.length ?? 0} упражнений
      </p>
      {children && <div className="program-card__actions">{children}</div>}
    </div>
  );
}
