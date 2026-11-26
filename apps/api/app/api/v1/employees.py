from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import AdminContext, get_current_admin
from app.db.models import Employee
from app.db.session import get_db
from app.schemas.employees import EmployeeCreate, EmployeeOut, EmployeeUpdate

router = APIRouter(prefix="/employees", tags=["employees"])


def _out(emp: Employee) -> EmployeeOut:
    return EmployeeOut(
        id=str(emp.id),
        email=emp.email,
        full_name=emp.full_name,
        department=emp.department,
        is_active=emp.is_active,
        created_at=emp.created_at,
    )


@router.get("", response_model=list[EmployeeOut])
async def list_employees(
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> list[EmployeeOut]:
    result = await db.execute(
        select(Employee)
        .where(Employee.organization_id == admin.organization_id)
        .order_by(Employee.full_name)
    )
    return [_out(e) for e in result.scalars().all()]


@router.post("", response_model=EmployeeOut, status_code=status.HTTP_201_CREATED)
async def create_employee(
    body: EmployeeCreate,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> EmployeeOut:
    emp = Employee(
        organization_id=admin.organization_id,
        email=body.email,
        full_name=body.full_name,
        department=body.department,
    )
    db.add(emp)
    await db.commit()
    await db.refresh(emp)
    return _out(emp)


@router.patch("/{employee_id}", response_model=EmployeeOut)
async def update_employee(
    employee_id: UUID,
    body: EmployeeUpdate,
    admin: AdminContext = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db),
) -> EmployeeOut:
    result = await db.execute(
        select(Employee).where(
            Employee.id == employee_id,
            Employee.organization_id == admin.organization_id,
        )
    )
    emp = result.scalar_one_or_none()
    if emp is None:
        raise HTTPException(status_code=404, detail="Employee not found")
    if body.full_name is not None:
        emp.full_name = body.full_name
    if body.department is not None:
        emp.department = body.department
    if body.is_active is not None:
        emp.is_active = body.is_active
    await db.commit()
    await db.refresh(emp)
    return _out(emp)
