import { describe, expect, it } from 'vitest';
import { parsePastedSchedule } from './parsePastedSchedule';

describe('parsePastedSchedule', () => {
  it('parses a PeopleSoft list-view paste (tab-separated cells)', () => {
    const text = [
      'CHEM 0110 - GENERAL CHEMISTRY 1',
      'Status\tUnits\tGrading',
      'Enrolled\t4.00\tLG Letter Grade',
      'Class Nbr\tSection\tComponent\tDays & Times\tRoom\tInstructor\tStart/End Date',
      '28510\t1030-LEC\tLecture\tMoWeFr 9:00AM - 9:50AM\tChevron Science Center 150\tJane Doe\t08/24/2026 - 12/04/2026',
      '\t1035-REC\tRecitation\tTu 10:00AM - 10:50AM\tEberly Hall 226\tJane Doe\t08/24/2026 - 12/04/2026',
      '',
      'MATH 0220 - ANALYTIC GEOMETRY & CALCULUS 1',
      '28900\t1100-LEC\tLecture\tTuTh 1:00PM - 2:15PM\tCathedral of Learning 332\tJohn Roe\t08/24/2026 - 12/04/2026',
    ].join('\n');

    const parsed = parsePastedSchedule(text);
    expect(parsed).toHaveLength(3);
    expect(parsed[0]).toMatchObject({
      label: 'CHEM 0110 LEC',
      title: 'GENERAL CHEMISTRY 1',
      days: ['Mo', 'We', 'Fr'],
      startTime: '09:00',
      endTime: '09:50',
    });
    expect(parsed[0].location).toContain('Chevron Science Center 150');
    expect(parsed[1]).toMatchObject({
      label: 'CHEM 0110 REC',
      days: ['Tu'],
      startTime: '10:00',
      endTime: '10:50',
    });
    expect(parsed[2]).toMatchObject({
      label: 'MATH 0220 LEC',
      days: ['Tu', 'Th'],
      startTime: '13:00',
      endTime: '14:15',
    });
  });

  it('parses one-liner pastes with inline course codes', () => {
    const parsed = parsePastedSchedule(
      'CHEM 0110 MoWeFr 9:00AM - 9:50AM Chevron Science Center 150',
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].label).toBe('CHEM 0110');
    expect(parsed[0].days).toEqual(['Mo', 'We', 'Fr']);
    expect(parsed[0].location).toContain('Chevron Science Center 150');
  });

  it('handles en dashes, lowercase am/pm, and "to" separators', () => {
    const parsed = parsePastedSchedule(
      'PHYS 0174 - BASIC PHYSICS 1\nLecture TuTh 11:00am – 12:15pm Allen Hall 103',
    );
    expect(parsed[0]).toMatchObject({ startTime: '11:00', endTime: '12:15', days: ['Tu', 'Th'] });

    const to = parsePastedSchedule('ENGR 0011 - INTRO\nMoWe 3:00PM to 4:15PM Benedum Hall G30');
    expect(to[0]).toMatchObject({ startTime: '15:00', endTime: '16:15' });
  });

  it('converts noon and midnight edges correctly', () => {
    const parsed = parsePastedSchedule('HIST 0100 - X\nFr 12:00PM - 12:50PM Posvar Hall 1500');
    expect(parsed[0]).toMatchObject({ startTime: '12:00', endTime: '12:50' });
  });

  it('skips meeting lines with no course context and ignores noise', () => {
    expect(parsePastedSchedule('MoWeFr 9:00AM - 9:50AM Somewhere 101')).toHaveLength(0);
    expect(parsePastedSchedule('random text\nno schedule here')).toHaveLength(0);
    expect(parsePastedSchedule('')).toHaveLength(0);
  });

  it('treats TBA rooms as no location and dedupes repeated meeting rows', () => {
    const parsed = parsePastedSchedule(
      [
        'CS 0007 - INTRO TO PROGRAMMING',
        'Lecture\tMoWe 2:00PM - 3:15PM\tTBA',
        'Lecture\tMoWe 2:00PM - 3:15PM\tTBA',
      ].join('\n'),
    );
    expect(parsed).toHaveLength(1);
    expect(parsed[0].location).toBeNull();
  });
});
