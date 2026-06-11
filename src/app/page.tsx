import { Nav } from '@/components/landing/Nav'
import { Hero } from '@/components/landing/Hero'
import { LangStrip } from '@/components/landing/LangStrip'
import { Features } from '@/components/landing/Features'
import { WhyUs } from '@/components/landing/WhyUs'
import { QualitySection } from '@/components/landing/QualitySection'
import { TechSection } from '@/components/landing/TechSection'
import { Pricing } from '@/components/landing/Pricing'
import { Testimonials } from '@/components/landing/Testimonials'
import { CtaBand } from '@/components/landing/CtaBand'
import { Footer } from '@/components/landing/Footer'

export default function Home() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <LangStrip />
        <Features />
        <WhyUs />
        <QualitySection />
        <TechSection />
        <Pricing />
        <Testimonials />
        <CtaBand />
      </main>
      <Footer />
    </>
  )
}
