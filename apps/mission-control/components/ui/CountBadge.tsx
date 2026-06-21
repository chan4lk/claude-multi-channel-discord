'use client'

import { useEffect, useRef } from 'react'
import { motion, useSpring, useTransform } from 'framer-motion'

interface CountBadgeProps {
  value: number
  label: string
  color?: string
  className?: string
}

function AnimatedNumber({ value }: { value: number }) {
  const spring = useSpring(value, { stiffness: 100, damping: 20 })
  const display = useTransform(spring, (v) => Math.round(v).toString())

  useEffect(() => {
    spring.set(value)
  }, [spring, value])

  return <motion.span>{display}</motion.span>
}

export default function CountBadge({ value, label, color = '#00F5FF', className }: CountBadgeProps) {
  return (
    <div className={`flex flex-col items-center gap-0.5${className ? ` ${className}` : ''}`}>
      <span className="text-xl font-bold font-mono" style={{ color }}>
        <AnimatedNumber value={value} />
      </span>
      <span className="text-xs text-slate-400 uppercase tracking-wider">{label}</span>
    </div>
  )
}
